/**
 * Coverage for /api/webhooks/razorpay.
 *
 * The webhook is the most security-critical surface in the app — Razorpay
 * dispatches subscription state directly into our DB, so a bug here is a
 * monetary integrity bug. The tests assert the four invariants we promise:
 *
 *   1. **Signature verification is mandatory.** Missing secret → 500. Bad
 *      signature → 400. Empty signature → 400. Replay-resistant via the
 *      timing-safe HMAC comparison in the route.
 *   2. **Currency is asserted.** A payment with currency != configured
 *      CURRENCY is rejected with 400 even if the signature is valid.
 *   3. **Amount is asserted.** A payment for an unexpected amount (not in
 *      ALL_PLAN_AMOUNTS_PAISE, not zero) is rejected with 400.
 *   4. **Idempotent.** A duplicate event (same `event.id`) returns 200 with
 *      `{ duplicate: true }` and does not double-update subscription state.
 *
 * We don't drive a real Postgres or Razorpay; we mock @supabase/supabase-js
 * and assert behaviour at the route boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ── Mock Razorpay env BEFORE importing anything that reads it ────────
// The lib/razorpay module reads process.env at import time, so we have to
// set these before vi.resetModules() forces a fresh import below.
const WEBHOOK_SECRET = 'test_webhook_secret_xyz';
const STARTER_PRICE = 39900; // ₹399 in paise
const PRO_PRICE = 69900;     // ₹699 in paise

beforeEach(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.RAZORPAY_CURRENCY = 'INR';
  process.env.RAZORPAY_PLAN_ID = 'plan_starter_test';
  process.env.RAZORPAY_PRO_PLAN_ID = 'plan_pro_test';
  // The route's plan-amount allowlist is built at module-import time inside
  // src/lib/razorpay.ts, which reads RAZORPAY_MONTHLY_PRICE for the starter
  // tier. The naming is historical — there used to be only one tier — and
  // the env-var name doesn't match the constant. We must use the env name
  // the lib actually reads, then rely on vi.resetModules() in postEvent to
  // force a fresh import that picks these up.
  process.env.RAZORPAY_MONTHLY_PRICE = String(STARTER_PRICE);
  process.env.RAZORPAY_PRO_MONTHLY_PRICE = String(PRO_PRICE);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc_test';
  // Reset the mock state observed by every test.
  insertedEvents.length = 0;
  updatedSubscriptions.length = 0;
  duplicateEventIds.clear();
});

// ── Mocks: Supabase admin client + email send ────────────────────────

interface InsertedEvent {
  event_id: string;
  event_type: string;
  subscription_id: string | null;
  payment_id: string | null;
  // Status field tracks the two-phase received → processed transition
  // introduced in migration 023. The route inserts as 'received', then
  // flips to 'processed' after the handler succeeds. Duplicate-event
  // delivery looks up this status to decide skip-vs-reprocess.
  status: 'received' | 'processed' | 'failed';
}
interface SubscriptionUpdate {
  subscription_id: string;
  patch: Record<string, unknown>;
}
const insertedEvents: InsertedEvent[] = [];
const updatedSubscriptions: SubscriptionUpdate[] = [];
const duplicateEventIds = new Set<string>();

vi.mock('@supabase/supabase-js', () => {
  /**
   * The route's chains we need to fake:
   *   .from('webhook_events').insert(...).select('event_id').maybeSingle()
   *   .from('subscriptions').update(...).eq(...)
   *   .from('subscriptions').select(...).eq(...).maybeSingle()  (only in payment-failed path)
   *
   * We discriminate by table + terminal — anything we don't model returns null.
   */
  return {
    createClient: () => ({
      from: (table: string) => buildTableChain(table),
      auth: {
        admin: {
          getUserById: async () => ({ data: { user: null } }),
        },
      },
    }),
  };
});

function buildTableChain(table: string) {
  return {
    // The two-phase webhook handler now uses .insert() WITHOUT a chained
    // .select() — it just returns the error result directly. Older code
    // expected a .select().maybeSingle() chain. Support both shapes so a
    // future revert doesn't silently break this test.
    insert: (row: Record<string, unknown>) => {
      if (table === 'webhook_events') {
        const eventId = row.event_id as string;
        if (duplicateEventIds.has(eventId)) {
          // Mimic Postgres unique-violation code 23505.
          const dupResult = { data: null, error: { code: '23505', message: 'duplicate key' } };
          // Bare-await path (current route): callers do `await supabase.insert(...)` and read .error.
          // We expose `then` so awaiting the insert directly resolves to dupResult.
          return {
            then: (cb: (v: typeof dupResult) => unknown) => Promise.resolve(dupResult).then(cb),
            select: () => ({
              maybeSingle: async () => dupResult,
            }),
          };
        }
        duplicateEventIds.add(eventId);
        insertedEvents.push({
          event_id: eventId,
          event_type: row.event_type as string,
          subscription_id: (row.subscription_id as string) ?? null,
          payment_id: (row.payment_id as string) ?? null,
          // The route inserts with status='received'; .update({status:'processed'})
          // fires after handler success and is captured by the update branch below.
          status: (row.status as 'received' | 'processed' | 'failed') ?? 'received',
        });
        const okResult = { data: { event_id: eventId }, error: null };
        return {
          then: (cb: (v: typeof okResult) => unknown) => Promise.resolve(okResult).then(cb),
          select: () => ({
            maybeSingle: async () => okResult,
          }),
        };
      }
      // email_log inserts — ignore
      return {
        then: (cb: (v: { data: null; error: null }) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(cb),
        select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      };
    },
    update: (patch: Record<string, unknown>) => ({
      eq: async (col: string, value: string) => {
        if (table === 'subscriptions') {
          updatedSubscriptions.push({ subscription_id: value, patch });
        }
        if (table === 'webhook_events' && col === 'event_id') {
          // The route flips status to 'processed' after handler success and
          // to 'failed' on handler error. Track that so the post-23505
          // select below returns the right status for the dedup decision.
          const ev = insertedEvents.find((e) => e.event_id === value);
          if (ev && typeof patch.status === 'string') {
            ev.status = patch.status as 'received' | 'processed' | 'failed';
          }
        }
        return { data: null, error: null };
      },
    }),
    select: (_cols?: string) => ({
      eq: (col: string, value: string) => ({
        maybeSingle: async () => {
          // Post-23505 dedup lookup: the route reads webhook_events.status
          // by event_id to decide skip-vs-reprocess. Return the tracked
          // status from insertedEvents so duplicates after handler success
          // resolve to {duplicate: true}.
          if (table === 'webhook_events' && col === 'event_id') {
            const ev = insertedEvents.find((e) => e.event_id === value);
            return { data: ev ? { status: ev.status } : null, error: null };
          }
          return { data: null, error: null };
        },
      }),
    }),
  };
}

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async () => ({ id: 'email_test' })),
}));

// ── Helpers ──────────────────────────────────────────────────────────

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function postEvent(
  body: object,
  signature: string | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  vi.resetModules();
  const mod = await import('@/app/api/webhooks/razorpay/route');
  const rawBody = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) headers['x-razorpay-signature'] = signature;
  const req = new Request('http://test/api/webhooks/razorpay', {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const res = await mod.POST(req);
  const data = await res.json();
  return { status: res.status, body: data };
}

function chargedEvent(opts: {
  eventId: string;
  subscriptionId: string;
  paymentId: string;
  amount: number;
  currency: string;
}) {
  return {
    id: opts.eventId,
    event: 'subscription.charged',
    payload: {
      subscription: { entity: { id: opts.subscriptionId, status: 'active' } },
      payment: {
        entity: {
          id: opts.paymentId,
          status: 'captured',
          amount: opts.amount,
          currency: opts.currency,
        },
      },
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('/api/webhooks/razorpay — security invariants', () => {
  it('returns 500 when RAZORPAY_WEBHOOK_SECRET is unset', async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = '';
    const body = chargedEvent({
      eventId: 'evt_001',
      subscriptionId: 'sub_001',
      paymentId: 'pay_001',
      amount: STARTER_PRICE,
      currency: 'INR',
    });
    const sig = sign(JSON.stringify(body), 'whatever'); // sig present but secret unset
    const { status, body: resp } = await postEvent(body, sig);
    expect(status).toBe(500);
    expect(resp.error).toMatch(/not configured/i);
  });

  it('returns 400 when signature header is missing', async () => {
    const body = chargedEvent({
      eventId: 'evt_002',
      subscriptionId: 'sub_002',
      paymentId: 'pay_002',
      amount: STARTER_PRICE,
      currency: 'INR',
    });
    const { status, body: resp } = await postEvent(body, null);
    expect(status).toBe(400);
    expect(resp.error).toMatch(/missing signature/i);
  });

  it('returns 400 when signature does not match the body', async () => {
    const body = chargedEvent({
      eventId: 'evt_003',
      subscriptionId: 'sub_003',
      paymentId: 'pay_003',
      amount: STARTER_PRICE,
      currency: 'INR',
    });
    const tamperedSig = sign(JSON.stringify(body), 'wrong_secret');
    const { status, body: resp } = await postEvent(body, tamperedSig);
    expect(status).toBe(400);
    expect(resp.error).toMatch(/invalid signature/i);
  });

  it('returns 400 when currency mismatches CURRENCY env', async () => {
    const body = chargedEvent({
      eventId: 'evt_004',
      subscriptionId: 'sub_004',
      paymentId: 'pay_004',
      amount: STARTER_PRICE,
      currency: 'USD', // ⚠ wrong
    });
    const sig = sign(JSON.stringify(body));
    const { status, body: resp } = await postEvent(body, sig);
    expect(status).toBe(400);
    expect(resp.error).toMatch(/currency mismatch/i);
    // Critical: subscription state must NOT have been touched.
    expect(updatedSubscriptions).toEqual([]);
  });

  it('returns 400 when amount does not match any known plan', async () => {
    const body = chargedEvent({
      eventId: 'evt_005',
      subscriptionId: 'sub_005',
      paymentId: 'pay_005',
      amount: 12345, // not a known plan amount
      currency: 'INR',
    });
    const sig = sign(JSON.stringify(body));
    const { status, body: resp } = await postEvent(body, sig);
    expect(status).toBe(400);
    expect(resp.error).toMatch(/unexpected amount/i);
    expect(updatedSubscriptions).toEqual([]);
  });

  it('accepts a valid signed event for the starter plan amount', async () => {
    const body = chargedEvent({
      eventId: 'evt_006',
      subscriptionId: 'sub_006',
      paymentId: 'pay_006',
      amount: STARTER_PRICE,
      currency: 'INR',
    });
    const sig = sign(JSON.stringify(body));
    const { status, body: resp } = await postEvent(body, sig);
    expect(status).toBe(200);
    expect(resp.received).toBe(true);
    expect(resp.eventType).toBe('subscription.charged');
    // The handler should have flipped the subscription to active.
    const update = updatedSubscriptions.find((u) => u.subscription_id === 'sub_006');
    expect(update).toBeTruthy();
    expect(update?.patch.status).toBe('active');
    expect(update?.patch.razorpay_payment_id).toBe('pay_006');
  });

  it('treats a duplicate event as a no-op (idempotent)', async () => {
    const body = chargedEvent({
      eventId: 'evt_007',
      subscriptionId: 'sub_007',
      paymentId: 'pay_007',
      amount: STARTER_PRICE,
      currency: 'INR',
    });
    const sig = sign(JSON.stringify(body));

    // First delivery — succeeds and updates state.
    const first = await postEvent(body, sig);
    expect(first.status).toBe(200);
    const updatesAfterFirst = updatedSubscriptions.filter(
      (u) => u.subscription_id === 'sub_007',
    ).length;

    // Second delivery (same event id) — must short-circuit before the handler.
    const second = await postEvent(body, sig);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    const updatesAfterSecond = updatedSubscriptions.filter(
      (u) => u.subscription_id === 'sub_007',
    ).length;

    // Critical: no extra subscription update on the duplicate.
    expect(updatesAfterSecond).toBe(updatesAfterFirst);
  });

  it('accepts a payment with amount=0 (trial auth charge)', async () => {
    const body = chargedEvent({
      eventId: 'evt_008',
      subscriptionId: 'sub_008',
      paymentId: 'pay_008',
      amount: 0,
      currency: 'INR',
    });
    const sig = sign(JSON.stringify(body));
    const { status } = await postEvent(body, sig);
    expect(status).toBe(200);
  });
});
