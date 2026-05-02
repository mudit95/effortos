/**
 * Coverage for /api/subscription/pause and /api/subscription/resume.
 *
 * The pause flow is monetarily relevant — wrong status transitions
 * cost real money (a paused user still being charged) or revenue
 * (an active user accidentally locked out). Tests pin down the
 * status-transition matrix and the Razorpay-call invariants.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface SubRow {
  id: string;
  user_id: string;
  razorpay_subscription_id: string;
  status: string;
  paused_at: string | null;
}

interface MockState {
  authUser: { id: string; email: string } | null;
  existingSub: SubRow | null;
  pauseCalls: Array<{ id: string; opts: Record<string, unknown> }>;
  resumeCalls: Array<{ id: string; opts: Record<string, unknown> }>;
  upsertedRow: Record<string, unknown> | null;
  rzpThrows: boolean;
}

const state: MockState = {
  authUser: null,
  existingSub: null,
  pauseCalls: [],
  resumeCalls: [],
  upsertedRow: null,
  rzpThrows: false,
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.authUser } }) },
    from: () => buildChain(),
  }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => buildChain(),
  }),
}));

vi.mock('@/lib/ratelimit', () => ({
  rateLimitOrNull: async () => null,
}));

vi.mock('@/lib/razorpay', () => ({
  getRazorpay: () => ({
    subscriptions: {
      pause: vi.fn(async (id: string, opts: Record<string, unknown>) => {
        state.pauseCalls.push({ id, opts });
        if (state.rzpThrows) throw new Error('rzp test failure');
      }),
      resume: vi.fn(async (id: string, opts: Record<string, unknown>) => {
        state.resumeCalls.push({ id, opts });
        if (state.rzpThrows) throw new Error('rzp test failure');
      }),
    },
  }),
}));

function buildChain() {
  return {
    select: () => ({
      eq: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: async () => ({ data: state.existingSub }),
          }),
        }),
      }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: () => ({
        eq: async () => {
          state.upsertedRow = patch;
          return { error: null };
        },
      }),
    }),
  };
}

function reset(): void {
  state.authUser = { id: 'user-aaa', email: 'aanya@example.com' };
  state.existingSub = null;
  state.pauseCalls = [];
  state.resumeCalls = [];
  state.upsertedRow = null;
  state.rzpThrows = false;
}

async function postPause(): Promise<{ status: number; body: Record<string, unknown> }> {
  vi.resetModules();
  const mod = await import('@/app/api/subscription/pause/route');
  const res = await mod.POST();
  return { status: res.status, body: await res.json() };
}

async function postResume(): Promise<{ status: number; body: Record<string, unknown> }> {
  vi.resetModules();
  const mod = await import('@/app/api/subscription/resume/route');
  const res = await mod.POST();
  return { status: res.status, body: await res.json() };
}

// ── /api/subscription/pause ──────────────────────────────────────

describe('/api/subscription/pause', () => {
  beforeEach(() => reset());

  it('401 when unauthenticated', async () => {
    state.authUser = null;
    const { status, body } = await postPause();
    expect(status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('404 when no subscription exists', async () => {
    const { status, body } = await postPause();
    expect(status).toBe(404);
    expect(body.error).toContain('No active subscription');
  });

  it('409 with helpful message when subscription is past_due', async () => {
    // Past-due users must fix payment before pausing — pause without
    // a working payment method has no resume story.
    state.existingSub = {
      id: 'sub-row-1',
      user_id: 'user-aaa',
      razorpay_subscription_id: 'rzp_sub_1',
      status: 'past_due',
      paused_at: null,
    };
    const { status, body } = await postPause();
    expect(status).toBe(409);
    expect(body.error).toMatch(/payment method/i);
    // Razorpay should NOT have been called.
    expect(state.pauseCalls).toEqual([]);
  });

  it('409 when subscription is cancelled or expired', async () => {
    state.existingSub = {
      id: 'sub-row-1',
      user_id: 'user-aaa',
      razorpay_subscription_id: 'rzp_sub_1',
      status: 'cancelled',
      paused_at: null,
    };
    const { status } = await postPause();
    expect(status).toBe(409);
    expect(state.pauseCalls).toEqual([]);
  });

  it('idempotent when already paused — returns success without re-calling Razorpay', async () => {
    state.existingSub = {
      id: 'sub-row-1',
      user_id: 'user-aaa',
      razorpay_subscription_id: 'rzp_sub_1',
      status: 'paused',
      paused_at: '2026-04-15T00:00:00.000Z',
    };
    const { status, body } = await postPause();
    expect(status).toBe(200);
    expect(body.already_paused).toBe(true);
    // Critical: we must NOT call Razorpay's pause again — it 4xxs.
    expect(state.pauseCalls).toEqual([]);
  });

  it('happy path: active subscription pauses + DB updates', async () => {
    state.existingSub = {
      id: 'sub-row-1',
      user_id: 'user-aaa',
      razorpay_subscription_id: 'rzp_sub_1',
      status: 'active',
      paused_at: null,
    };
    const { status, body } = await postPause();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // Razorpay called with the right id and immediate-pause flag.
    expect(state.pauseCalls).toHaveLength(1);
    expect(state.pauseCalls[0]).toEqual({
      id: 'rzp_sub_1',
      opts: { pause_at: 'now' },
    });
    // DB updated with status + paused_at timestamp.
    expect(state.upsertedRow?.status).toBe('paused');
    expect(state.upsertedRow?.paused_at).toBeTruthy();
  });

  it('502 when Razorpay throws', async () => {
    state.existingSub = {
      id: 'sub-row-1',
      user_id: 'user-aaa',
      razorpay_subscription_id: 'rzp_sub_1',
      status: 'active',
      paused_at: null,
    };
    state.rzpThrows = true;
    const { status, body } = await postPause();
    expect(status).toBe(502);
    expect(body.error).toMatch(/razorpay/i);
    // DB should NOT have been updated since the upstream call failed.
    expect(state.upsertedRow).toBeNull();
  });
});

// ── /api/subscription/resume ─────────────────────────────────────

describe('/api/subscription/resume', () => {
  beforeEach(() => reset());

  it('401 when unauthenticated', async () => {
    state.authUser = null;
    const { status } = await postResume();
    expect(status).toBe(401);
  });

  it('404 when no subscription exists', async () => {
    const { status } = await postResume();
    expect(status).toBe(404);
  });

  it('idempotent when already active — returns success without re-calling Razorpay', async () => {
    state.existingSub = {
      id: 'sub-row-1',
      user_id: 'user-aaa',
      razorpay_subscription_id: 'rzp_sub_1',
      status: 'active',
      paused_at: null,
    };
    const { status, body } = await postResume();
    expect(status).toBe(200);
    expect(body.already_active).toBe(true);
    expect(state.resumeCalls).toEqual([]);
  });

  it('409 when subscription is cancelled', async () => {
    state.existingSub = {
      id: 'sub-row-1',
      user_id: 'user-aaa',
      razorpay_subscription_id: 'rzp_sub_1',
      status: 'cancelled',
      paused_at: null,
    };
    const { status } = await postResume();
    expect(status).toBe(409);
    expect(state.resumeCalls).toEqual([]);
  });

  it('happy path: paused subscription resumes + clears paused_at', async () => {
    state.existingSub = {
      id: 'sub-row-1',
      user_id: 'user-aaa',
      razorpay_subscription_id: 'rzp_sub_1',
      status: 'paused',
      paused_at: '2026-04-15T00:00:00.000Z',
    };
    const { status, body } = await postResume();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(state.resumeCalls).toEqual([{
      id: 'rzp_sub_1',
      opts: { resume_at: 'now' },
    }]);
    expect(state.upsertedRow?.status).toBe('active');
    expect(state.upsertedRow?.paused_at).toBeNull();
  });
});
