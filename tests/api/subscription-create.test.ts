/**
 * Race-condition coverage for /api/subscription/create.
 *
 * The endpoint has three sequenced steps that are vulnerable to a double-click
 * (or two near-simultaneous tabs):
 *
 *   1. Check if the user already has an active subscription.
 *   2. Call Razorpay subscriptions.create — opens a real Razorpay record.
 *   3. Upsert into Supabase, then re-read with .maybeSingle() to see who won
 *      the upsert (Postgres serialises the unique-on-user_id constraint).
 *   4. If the re-read shows a different razorpay_subscription_id than what we
 *      just created, cancel our orphan at Razorpay and return the winner's id.
 *
 * These tests don't drive a real Postgres or Razorpay; they mock both and
 * assert the *behaviour* of step 4 — that the loser cancels its orphan and
 * returns `deduplicated: true`, and the winner does neither.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock infrastructure ─────────────────────────────────────────────

type SubRow = {
  user_id: string;
  razorpay_subscription_id: string;
  plan_id: string;
  plan_tier: 'starter' | 'pro';
  billing_cadence?: 'monthly' | 'annual';
  status: string;
  trial_ends_at: string | null;
  created_at: string;
};

interface MockState {
  authUser: { id: string; email: string } | null;
  // Result of the existence check (existing active subscription).
  existingActive: SubRow | null;
  // What the post-upsert re-read returns. Tests configure this to simulate
  // either "we won" (matches our id) or "we lost" (different id).
  postUpsertRead:
    | (Pick<SubRow, 'razorpay_subscription_id' | 'plan_tier' | 'status' | 'trial_ends_at'> & { billing_cadence?: 'monthly' | 'annual' })
    | null;
  // Razorpay create returns this id; tests inspect cancel calls to verify
  // orphan-cleanup behaviour.
  razorpayCreatedId: string;
  cancelCalls: string[];
  // Counter for sequencing reads against a single Supabase mock — kept on
  // state (not inside buildFromChain) because each .from() call returns a
  // fresh chain and we need the count to span calls.
  readCount: number;
  // Captures the upsert payload so cadence-related tests can assert that
  // billing_cadence is persisted correctly.
  upsertedRow: Record<string, unknown> | null;
  // Captures the (tier, cycle) tuple the route asked the plan-resolver for,
  // so tests can verify monthly vs annual routing.
  resolvedPlanCalls: Array<{ tier: string; cycle?: string }>;
}

const state: MockState = {
  authUser: null,
  existingActive: null,
  postUpsertRead: null,
  razorpayCreatedId: '',
  cancelCalls: [],
  readCount: 0,
  upsertedRow: null,
  resolvedPlanCalls: [],
};

// ── Mocks: Supabase, Razorpay, rate limiter ─────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.authUser } }),
    },
    from: (_table: string) => buildFromChain(),
  }),
}));

// The subscription-create route (post-RLS-hardening migration 022) writes
// to `subscriptions` via the service-role client to bypass the now-strict
// RLS policy. We mock both clients with the same chain builder — the test
// state is shared, so it doesn't matter which path the route takes.
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.authUser } }),
    },
    from: (_table: string) => buildFromChain(),
  }),
}));

vi.mock('@/lib/ratelimit', () => ({
  // Always allow — these tests aren't about the rate limiter.
  rateLimitOrNull: async () => null,
}));

vi.mock('@/lib/razorpay', () => ({
  getRazorpay: () => ({
    subscriptions: {
      create: vi.fn(async () => ({ id: state.razorpayCreatedId })),
      cancel: vi.fn(async (id: string) => {
        state.cancelCalls.push(id);
        return { ok: true };
      }),
    },
  }),
  // Honour both the tier and the cycle so cadence routing can be asserted.
  // Returns distinct, recognisable plan IDs per (tier × cycle) so tests can
  // tell which combination the route asked for.
  getPlanIdForTier: (tier: 'starter' | 'pro', cycle: 'monthly' | 'annual' = 'monthly') => {
    state.resolvedPlanCalls.push({ tier, cycle });
    if (cycle === 'annual') {
      return tier === 'pro' ? 'plan_test_pro_annual' : 'plan_test_starter_annual';
    }
    return tier === 'pro' ? 'plan_test_pro' : 'plan_test_starter';
  },
  TRIAL_DAYS: 3,
}));

/**
 * Builds the chain of `.from(table).select().eq().in().maybeSingle()` etc.
 * We don't need to faithfully model every method — only the ones the route
 * actually calls. Each terminal returns the relevant mock state.
 */
function buildFromChain() {
  // The route, with no coupon attached, performs (in order):
  //   read 1: existing-active check  → select().eq().in().maybeSingle()
  //   write : upsert                 → upsert()
  //   read 2: post-upsert re-read    → select().eq().maybeSingle()
  //
  // We discriminate by which terminal is invoked: `.in().maybeSingle()`
  // returns the existing-active row, plain `.maybeSingle()` returns the
  // post-upsert read. Order is implicit in the route, not asserted here.
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          single: async () => ({ data: null }),
        }),
        in: () => ({
          maybeSingle: async () => {
            state.readCount += 1;
            return { data: state.existingActive };
          },
        }),
        maybeSingle: async () => {
          state.readCount += 1;
          return { data: state.postUpsertRead };
        },
      }),
    }),
    upsert: async (row: Record<string, unknown>) => {
      // Capture the most recent upsert payload so tests can read what the
      // route persisted (cadence, plan_id, etc.) without reaching for
      // private spies.
      state.upsertedRow = row;
      return { data: null, error: null };
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function reset(): void {
  state.authUser = { id: 'user-aaa', email: 'aanya@example.com' };
  state.existingActive = null;
  state.postUpsertRead = null;
  state.razorpayCreatedId = '';
  state.cancelCalls = [];
  state.readCount = 0;
  state.upsertedRow = null;
  state.resolvedPlanCalls = [];
}

async function callRoute(
  body: Record<string, unknown> = { tier: 'starter' },
): Promise<{ status: number; body: Record<string, unknown> }> {
  // Re-import the route fresh per test so module-level state (if any) resets.
  vi.resetModules();
  const mod = await import('@/app/api/subscription/create/route');
  const req = new Request('http://test/api/subscription/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await mod.POST(req);
  const respBody = await res.json();
  return { status: res.status, body: respBody };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('/api/subscription/create — race resolution', () => {
  beforeEach(() => {
    reset();
  });

  it('happy path: post-upsert read matches our Razorpay id → no cancel, no dedupe flag', async () => {
    state.razorpayCreatedId = 'sub_winner_001';
    state.postUpsertRead = {
      razorpay_subscription_id: 'sub_winner_001',
      plan_tier: 'starter',
      status: 'trialing',
      trial_ends_at: new Date().toISOString(),
    };

    const { status, body } = await callRoute();

    expect(status).toBe(200);
    expect(body.subscription_id).toBe('sub_winner_001');
    expect(body.deduplicated).toBeUndefined();
    expect(state.cancelCalls).toEqual([]);
  });

  it('lost race: post-upsert read shows a different id → orphan cancelled, dedupe flag set', async () => {
    // We created sub_orphan_002 but the concurrent winner was sub_winner_001.
    state.razorpayCreatedId = 'sub_orphan_002';
    state.postUpsertRead = {
      razorpay_subscription_id: 'sub_winner_001',
      plan_tier: 'starter',
      status: 'trialing',
      trial_ends_at: new Date().toISOString(),
    };

    const { status, body } = await callRoute();

    expect(status).toBe(200);
    expect(body.subscription_id).toBe('sub_winner_001');
    expect(body.deduplicated).toBe(true);
    // Critical assertion: we must cancel the orphan we just created at Razorpay.
    expect(state.cancelCalls).toEqual(['sub_orphan_002']);
  });

  it('returns 409 when user already has an active subscription of the same tier', async () => {
    state.existingActive = {
      user_id: 'user-aaa',
      razorpay_subscription_id: 'sub_existing',
      plan_id: 'plan_starter',
      plan_tier: 'starter',
      status: 'active',
      trial_ends_at: null,
      created_at: new Date().toISOString(),
    };

    const { status, body } = await callRoute();

    expect(status).toBe(409);
    expect(body.error).toBe('Already subscribed');
    expect(state.cancelCalls).toEqual([]);
  });

  it('returns 401 when not authenticated', async () => {
    state.authUser = null;
    const { status, body } = await callRoute();
    expect(status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });
});

describe('/api/subscription/create — billing cadence', () => {
  beforeEach(() => {
    reset();
  });

  it('cadence: "annual" routes to the annual plan id and persists billing_cadence', async () => {
    state.razorpayCreatedId = 'sub_annual_001';
    state.postUpsertRead = {
      razorpay_subscription_id: 'sub_annual_001',
      plan_tier: 'pro',
      billing_cadence: 'annual',
      status: 'trialing',
      trial_ends_at: new Date().toISOString(),
    };

    const { status, body } = await callRoute({ tier: 'pro', cadence: 'annual' });

    expect(status).toBe(200);
    expect(body.subscription_id).toBe('sub_annual_001');
    expect(body.billing_cadence).toBe('annual');
    expect(body.plan_tier).toBe('pro');

    // Plan resolver should have been called with cycle='annual' for tier='pro'.
    const proAnnualCall = state.resolvedPlanCalls.find(
      c => c.tier === 'pro' && c.cycle === 'annual',
    );
    expect(proAnnualCall).toBeDefined();

    // Persisted row carries cadence and the annual plan id.
    expect(state.upsertedRow?.billing_cadence).toBe('annual');
    expect(state.upsertedRow?.plan_id).toBe('plan_test_pro_annual');
  });

  it('cadence omitted defaults to monthly', async () => {
    state.razorpayCreatedId = 'sub_monthly_default';
    state.postUpsertRead = {
      razorpay_subscription_id: 'sub_monthly_default',
      plan_tier: 'starter',
      billing_cadence: 'monthly',
      status: 'trialing',
      trial_ends_at: new Date().toISOString(),
    };

    const { status, body } = await callRoute({ tier: 'starter' });

    expect(status).toBe(200);
    expect(body.billing_cadence).toBe('monthly');
    expect(state.upsertedRow?.billing_cadence).toBe('monthly');
    expect(state.upsertedRow?.plan_id).toBe('plan_test_starter');
  });

  it('cadence: "yearly" (typo) is rejected and falls back to monthly', async () => {
    // Defence-in-depth: the route whitelists only 'annual'. Anything else
    // — typos like 'yearly', empty string, malicious payloads — must
    // route to monthly so a stale build can't trick checkout into
    // charging the wrong amount.
    state.razorpayCreatedId = 'sub_typo_fallback';
    state.postUpsertRead = {
      razorpay_subscription_id: 'sub_typo_fallback',
      plan_tier: 'starter',
      billing_cadence: 'monthly',
      status: 'trialing',
      trial_ends_at: new Date().toISOString(),
    };

    const { status, body } = await callRoute({ tier: 'starter', cadence: 'yearly' });

    expect(status).toBe(200);
    expect(body.billing_cadence).toBe('monthly');
    expect(state.upsertedRow?.billing_cadence).toBe('monthly');
  });

  it('cadence upgrade: existing monthly + new annual same tier triggers upgrade flow', async () => {
    // Existing monthly Pro user wants to switch to annual Pro to lock in
    // the discount. /create should treat this as an upgrade: cancel the
    // old Razorpay subscription, set status=active immediately (no fresh
    // trial), persist billing_cadence='annual'.
    state.existingActive = {
      user_id: 'user-aaa',
      razorpay_subscription_id: 'sub_existing_monthly',
      plan_id: 'plan_test_pro',
      plan_tier: 'pro',
      billing_cadence: 'monthly',
      status: 'active',
      trial_ends_at: null,
      created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    };
    state.razorpayCreatedId = 'sub_new_annual';
    state.postUpsertRead = {
      razorpay_subscription_id: 'sub_new_annual',
      plan_tier: 'pro',
      billing_cadence: 'annual',
      status: 'active',
      trial_ends_at: null,
    };

    const { status, body } = await callRoute({ tier: 'pro', cadence: 'annual' });

    expect(status).toBe(200);
    expect(body.billing_cadence).toBe('annual');
    // The old monthly Razorpay sub should be cancelled to avoid double-billing.
    expect(state.cancelCalls).toContain('sub_existing_monthly');
    // Status should be active immediately (no new 3-day trial).
    expect(state.upsertedRow?.status).toBe('active');
    expect(state.upsertedRow?.billing_cadence).toBe('annual');
  });

  it('blocks duplicate annual: existing annual + new annual same tier returns 409', async () => {
    state.existingActive = {
      user_id: 'user-aaa',
      razorpay_subscription_id: 'sub_existing_annual',
      plan_id: 'plan_test_starter_annual',
      plan_tier: 'starter',
      billing_cadence: 'annual',
      status: 'active',
      trial_ends_at: null,
      created_at: new Date().toISOString(),
    };

    const { status, body } = await callRoute({ tier: 'starter', cadence: 'annual' });

    expect(status).toBe(409);
    expect(body.error).toBe('Already subscribed');
    // No Razorpay calls should have happened — we short-circuited.
    expect(state.cancelCalls).toEqual([]);
  });
});
