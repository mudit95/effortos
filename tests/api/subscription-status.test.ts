/**
 * Regression tests for /api/subscription/status
 *
 * Prevents the original bug where a trialing user whose admin had granted
 * premium (current_period_end in the future) was still shown the trial
 * banner with "Trial ends in 0h".
 *
 * Priority order that MUST hold:
 *   1. current_period_end in future                → 'active' (premium precedence)
 *      (regardless of whether DB status says 'trialing')
 *   2. status='trialing' + trial_ends_at in future → 'trialing'
 *   3. status='trialing' + trial_ends_at in past   → 'expired' (auto-transition)
 *   4. Everything else                              → returned as-is
 *   5. No subscription row at all                  → implicit 3-day trial from signup
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Supabase mock ---------------------------------------------------------

type SubRow = {
  id: string;
  user_id: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  razorpay_payment_id: string | null;
  razorpay_subscription_id: string | null;
};

// Mutable state the mock reads from / writes to within a single test
let mockUser: { id: string; created_at: string } | null = null;
let mockSub: SubRow | null = null;
const updates: Array<Partial<SubRow>> = [];

function makeSupabaseMock() {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: mockUser }, error: null })),
    },
    from: vi.fn((table: string) => {
      if (table !== 'subscriptions') throw new Error(`Unexpected table: ${table}`);

      // SELECT chain: .select(...).eq().order().limit().maybeSingle()
      const selectChain = {
        select: vi.fn(() => selectChain),
        eq: vi.fn(() => selectChain),
        order: vi.fn(() => selectChain),
        limit: vi.fn(() => selectChain),
        maybeSingle: vi.fn(async () => ({ data: mockSub, error: null })),
        // UPDATE chain: .update(patch).eq(col, val)
        update: vi.fn((patch: Partial<SubRow>) => {
          updates.push(patch);
          if (mockSub) mockSub = { ...mockSub, ...patch };
          return {
            eq: vi.fn(async () => ({ data: null, error: null })),
          };
        }),
      };
      return selectChain;
    }),
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => makeSupabaseMock()),
}));

// Import after mock setup
import { GET } from '@/app/api/subscription/status/route';

// --- Helpers ---------------------------------------------------------------

const NOW = new Date('2026-04-17T12:00:00Z');
const FUTURE = new Date('2026-05-14T12:00:00Z').toISOString();
const PAST = new Date('2026-04-10T12:00:00Z').toISOString();
const WITHIN_IMPLICIT_TRIAL = new Date('2026-04-16T00:00:00Z').toISOString(); // ~36h ago
const PAST_IMPLICIT_TRIAL = new Date('2026-04-01T00:00:00Z').toISOString();   // ~16d ago

function baseSub(overrides: Partial<SubRow> = {}): SubRow {
  return {
    id: 'sub_test_1',
    user_id: 'user_test_1',
    status: 'trialing',
    trial_ends_at: null,
    current_period_end: null,
    razorpay_payment_id: null,
    razorpay_subscription_id: null,
    ...overrides,
  };
}

async function callStatus(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

// --- Tests -----------------------------------------------------------------

describe('/api/subscription/status', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockUser = { id: 'user_test_1', created_at: '2026-03-01T00:00:00Z' };
    mockSub = null;
    updates.length = 0;
  });

  // ---- Auth -------------------------------------------------------------

  it('returns 401 when no authenticated user', async () => {
    mockUser = null;
    const { status, body } = await callStatus();
    expect(status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  // ---- No subscription row (implicit trial) ----------------------------

  it('returns implicit trialing when within 3 days of signup', async () => {
    mockUser = { id: 'user_test_1', created_at: WITHIN_IMPLICIT_TRIAL };
    mockSub = null;
    const { status, body } = await callStatus();
    expect(status).toBe(200);
    expect(body.status).toBe('trialing');
    expect(body.implicit).toBe(true);
  });

  it('returns expired when past the 3-day implicit trial', async () => {
    mockUser = { id: 'user_test_1', created_at: PAST_IMPLICIT_TRIAL };
    mockSub = null;
    const { status, body } = await callStatus();
    expect(status).toBe(200);
    expect(body.status).toBe('expired');
  });

  // ---- PRIORITY 1: premium takes precedence (the original bug) --------

  it('ORIGINAL BUG: trialing row with future current_period_end returns active', async () => {
    // Admin granted premium but left status='trialing' and trial_ends_at in future.
    // The endpoint MUST normalise this to 'active' so the TrialBanner hides.
    mockSub = baseSub({
      status: 'trialing',
      trial_ends_at: FUTURE,
      current_period_end: FUTURE,
    });
    const { body } = await callStatus();
    expect(body.status).toBe('active');
    // And persist the normalisation so subsequent reads are consistent
    expect(updates).toContainEqual({ status: 'active' });
  });

  it('active subscription with future period end returns active unchanged', async () => {
    mockSub = baseSub({
      status: 'active',
      current_period_end: FUTURE,
      razorpay_payment_id: 'pay_123',
    });
    const { body } = await callStatus();
    expect(body.status).toBe('active');
    // No re-normalisation on already-active rows
    expect(updates).toHaveLength(0);
  });

  it('past_due with future period end is preserved (grace period)', async () => {
    mockSub = baseSub({
      status: 'past_due',
      current_period_end: FUTURE,
    });
    const { body } = await callStatus();
    // past_due must NOT be flipped to active — the Razorpay card-retry is still
    // in progress and downstream UI shows a different banner.
    expect(body.status).toBe('past_due');
    expect(updates).toHaveLength(0);
  });

  it('cancelled-but-still-in-period is preserved', async () => {
    mockSub = baseSub({
      status: 'cancelled',
      current_period_end: FUTURE,
    });
    const { body } = await callStatus();
    // User cancelled but paid through end of month — they still have access
    // until current_period_end, but status stays 'cancelled' so the upsell UI
    // can show "Resubscribe" instead of nothing.
    expect(body.status).toBe('cancelled');
  });

  // ---- PRIORITY 2: trialing with future trial end ---------------------

  it('trialing with future trial_ends_at and no period end returns trialing', async () => {
    mockSub = baseSub({
      status: 'trialing',
      trial_ends_at: FUTURE,
      current_period_end: null,
    });
    const { body } = await callStatus();
    expect(body.status).toBe('trialing');
    expect(updates).toHaveLength(0);
  });

  // ---- PRIORITY 3: trial expired, no payment ever happened -----------

  it('trialing with past trial_ends_at auto-transitions to expired', async () => {
    mockSub = baseSub({
      status: 'trialing',
      trial_ends_at: PAST,
      current_period_end: null,
    });
    const { body } = await callStatus();
    expect(body.status).toBe('expired');
    expect(updates).toContainEqual({ status: 'expired' });
  });

  // ---- Edge: trialing row with past trial_ends_at BUT future period_end
  //           (admin-extended trial while granting premium).
  //           Premium precedence must win.

  it('admin-extended premium with stale past trial_ends_at still returns active', async () => {
    mockSub = baseSub({
      status: 'trialing',
      trial_ends_at: PAST,          // legacy / not cleared
      current_period_end: FUTURE,   // admin grant
    });
    const { body } = await callStatus();
    expect(body.status).toBe('active');
  });

  // ---- Terminal states pass through unchanged ------------------------

  it('expired row with no future period end returns expired', async () => {
    mockSub = baseSub({
      status: 'expired',
      trial_ends_at: PAST,
      current_period_end: PAST,
    });
    const { body } = await callStatus();
    expect(body.status).toBe('expired');
    expect(updates).toHaveLength(0);
  });

  it('cancelled row past period end returns cancelled', async () => {
    mockSub = baseSub({
      status: 'cancelled',
      current_period_end: PAST,
    });
    const { body } = await callStatus();
    expect(body.status).toBe('cancelled');
  });
});
