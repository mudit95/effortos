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
  postUpsertRead: Pick<SubRow, 'razorpay_subscription_id' | 'plan_tier' | 'status' | 'trial_ends_at'> | null;
  // Razorpay create returns this id; tests inspect cancel calls to verify
  // orphan-cleanup behaviour.
  razorpayCreatedId: string;
  cancelCalls: string[];
  // Counter for sequencing reads against a single Supabase mock — kept on
  // state (not inside buildFromChain) because each .from() call returns a
  // fresh chain and we need the count to span calls.
  readCount: number;
}

const state: MockState = {
  authUser: null,
  existingActive: null,
  postUpsertRead: null,
  razorpayCreatedId: '',
  cancelCalls: [],
  readCount: 0,
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
  getPlanIdForTier: (_tier: string) => 'plan_test_starter',
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
    upsert: async () => ({ data: null, error: null }),
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
}

async function callRoute(): Promise<{ status: number; body: any }> {
  // Re-import the route fresh per test so module-level state (if any) resets.
  vi.resetModules();
  const mod = await import('@/app/api/subscription/create/route');
  const req = new Request('http://test/api/subscription/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tier: 'starter' }),
  });
  const res = await mod.POST(req);
  const body = await res.json();
  return { status: res.status, body };
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
