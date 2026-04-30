/**
 * Forged-plan-tier protection for /api/subscription/verify.
 *
 * The route used to write `plan_tier` straight from the request body,
 * which let anyone holding a valid Razorpay HMAC for an existing
 * subscription downgrade themselves to Starter. The Day-1 hardening
 * pass (audit fix #5/#7) made the route ignore the body's plan_tier
 * and instead trust the value already written by /api/subscription/create.
 *
 * This test asserts: when the existing subscription row says plan_tier='pro',
 * a verify call with body { plan_tier: 'starter', valid signature } MUST
 * NOT downgrade the row to 'starter'.
 *
 * Status precedence is also asserted (active > trialing) so a webhook-set
 * 'active' isn't clobbered by verify's default 'trialing'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const HMAC_SECRET = 'whsec_test_verify';

// ── State ───────────────────────────────────────────────────────────
interface SubRow {
  id: string;
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired' | 'none';
  plan_tier: 'starter' | 'pro';
  current_period_end: string | null;
  applied_coupon_id: string | null;
}

interface MockState {
  authUser: { id: string; email: string } | null;
  subRow: SubRow | null;
  // What the route ended up writing. Captured to assert intent.
  lastUpdate: { status?: string; plan_tier?: string; razorpay_payment_id?: string } | null;
}

const state: MockState = {
  authUser: null,
  subRow: null,
  lastUpdate: null,
};

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.authUser } }) },
    from: () => ({}),
  }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: state.subRow }),
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: () => ({
          eq: () => {
            state.lastUpdate = payload as MockState['lastUpdate'];
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
      insert: () => Promise.resolve({ data: null, error: null }),
    }),
  }),
}));

vi.mock('@/lib/coach-welcome', () => ({
  sendProWelcome: async () => undefined,
}));

vi.mock('@/lib/analytics', () => ({
  track: async () => undefined,
}));

// ── Helpers ─────────────────────────────────────────────────────────

function reset(): void {
  state.authUser = { id: 'user-pro', email: 'p@example.com' };
  state.subRow = null;
  state.lastUpdate = null;
  process.env.RAZORPAY_KEY_SECRET = HMAC_SECRET;
}

function signRazorpay(paymentId: string, subId: string): string {
  return crypto.createHmac('sha256', HMAC_SECRET).update(`${paymentId}|${subId}`).digest('hex');
}

async function callRoute(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  vi.resetModules();
  const mod = await import('@/app/api/subscription/verify/route');
  const req = new Request('http://test/api/subscription/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await mod.POST(req);
  const out = await res.json();
  return { status: res.status, body: out };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('/api/subscription/verify — plan_tier + status protection', () => {
  beforeEach(() => {
    reset();
  });

  it('refuses to downgrade Pro → Starter when body forges plan_tier', async () => {
    state.subRow = {
      id: 's1',
      status: 'trialing',
      plan_tier: 'pro',
      current_period_end: null,
      applied_coupon_id: null,
    };
    const sig = signRazorpay('pay_x', 'sub_x');
    const res = await callRoute({
      razorpay_payment_id: 'pay_x',
      razorpay_subscription_id: 'sub_x',
      razorpay_signature: sig,
      plan_tier: 'starter', // ← forged downgrade attempt
    });

    expect(res.status).toBe(200);
    // Verify the response carries the AUTHORITATIVE tier (pro), not the body's.
    expect(res.body.plan_tier).toBe('pro');
    // And the actual DB write keeps plan_tier='pro'.
    expect(state.lastUpdate?.plan_tier).toBe('pro');
  });

  it('does not downgrade an already-active subscription back to trialing', async () => {
    state.subRow = {
      id: 's1',
      status: 'active',
      plan_tier: 'pro',
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      applied_coupon_id: null,
    };
    const sig = signRazorpay('pay_y', 'sub_y');
    const res = await callRoute({
      razorpay_payment_id: 'pay_y',
      razorpay_subscription_id: 'sub_y',
      razorpay_signature: sig,
      plan_tier: 'pro',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(state.lastUpdate?.status).toBe('active');
  });

  it('rejects an invalid HMAC signature with 400', async () => {
    state.subRow = {
      id: 's1',
      status: 'trialing',
      plan_tier: 'starter',
      current_period_end: null,
      applied_coupon_id: null,
    };
    const res = await callRoute({
      razorpay_payment_id: 'pay_z',
      razorpay_subscription_id: 'sub_z',
      razorpay_signature: 'this-is-not-a-real-hmac',
      plan_tier: 'pro',
    });
    expect(res.status).toBe(400);
    // No write should have happened.
    expect(state.lastUpdate).toBeNull();
  });
});
