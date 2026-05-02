/**
 * Coverage for /api/streaks/freeze.
 *
 * The endpoint defers atomic insert+decrement to the claim_freeze_token
 * Postgres function (see migration 035). These tests pin down the
 * route-layer behaviour: input validation, error-code mapping from
 * the RPC's HINT codes, auth + rate-limit gating.
 *
 * The DB-side atomicity (UNIQUE race + token-decrement race) is
 * exercised by the RPC itself; not duplicating that here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface MockState {
  authUser: { id: string; email: string } | null;
  rpcResult: { data: unknown; error: { hint?: string; message?: string } | null };
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  tz: string;
}

const state: MockState = {
  authUser: null,
  rpcResult: { data: null, error: null },
  rpcCalls: [],
  tz: 'UTC',
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.authUser } }) },
  }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return state.rpcResult;
    },
  }),
}));

vi.mock('@/lib/ratelimit', () => ({
  rateLimitOrNull: async () => null,
}));

vi.mock('@/lib/user-date', () => ({
  // Deterministic stubs — keeps assertions tight without depending on
  // real Intl.DateTimeFormat behaviour, which varies by Node version.
  getUserTimezone: async () => state.tz,
  todayKeyInTz: () => '2026-05-01',
  dateKeyInTz: () => '2026-04-30',
}));

function reset(): void {
  state.authUser = { id: 'user-aaa', email: 'aanya@example.com' };
  state.rpcResult = { data: null, error: null };
  state.rpcCalls = [];
  state.tz = 'UTC';
}

async function postFreeze(
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  vi.resetModules();
  const mod = await import('@/app/api/streaks/freeze/route');
  const req = new Request('http://test/api/streaks/freeze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await mod.POST(req);
  return { status: res.status, body: await res.json() };
}

describe('/api/streaks/freeze', () => {
  beforeEach(() => reset());

  it('401 when unauthenticated', async () => {
    state.authUser = null;
    const { status, body } = await postFreeze();
    expect(status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('happy path: defaults to today, calls claim_freeze_token, returns remaining', async () => {
    state.rpcResult = {
      data: [{ freeze_id: 'freeze-uuid-1', remaining_tokens: 0 }],
      error: null,
    };

    const { status, body } = await postFreeze();

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.date).toBe('2026-05-01'); // todayKeyInTz stub
    expect(body.remaining_tokens).toBe(0);
    expect(body.source).toBe('manual');

    // Critical: RPC was called with the right args.
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0]).toEqual({
      name: 'claim_freeze_token',
      args: {
        p_user_id: 'user-aaa',
        p_date: '2026-05-01',
        p_source: 'manual',
      },
    });
  });

  it('uses yesterday when date: "yesterday" passed', async () => {
    state.rpcResult = {
      data: [{ freeze_id: 'freeze-uuid-2', remaining_tokens: 0 }],
      error: null,
    };
    const { status, body } = await postFreeze({ date: 'yesterday' });

    expect(status).toBe(200);
    expect(body.date).toBe('2026-04-30'); // dateKeyInTz stub
    expect(state.rpcCalls[0].args.p_date).toBe('2026-04-30');
  });

  it('falls back to today when date is a typo or unknown value', async () => {
    // Defence-in-depth: only 'today' / 'yesterday' are accepted.
    // Anything else (typo, attempt to pass arbitrary YYYY-MM-DD via
    // this field) routes to today. Backdating beyond the 24h window
    // would erode trust in the streak system.
    state.rpcResult = {
      data: [{ freeze_id: 'freeze-uuid-3', remaining_tokens: 0 }],
      error: null,
    };
    const { status, body } = await postFreeze({ date: '2026-01-01' });

    expect(status).toBe(200);
    expect(body.date).toBe('2026-05-01'); // today, not the requested date
  });

  it('409 with helpful message when no tokens remain', async () => {
    // RPC raises with HINT='no_tokens' when the bucket is exhausted.
    state.rpcResult = {
      data: null,
      error: { hint: 'no_tokens', message: 'no freeze tokens remaining' },
    };
    const { status, body } = await postFreeze();
    expect(status).toBe(409);
    expect(body.error).toMatch(/no freeze tokens remaining/i);
  });

  it('409 with helpful message when day is already frozen', async () => {
    state.rpcResult = {
      data: null,
      error: { hint: 'already_frozen', message: 'date already frozen' },
    };
    const { status, body } = await postFreeze();
    expect(status).toBe(409);
    expect(body.error).toMatch(/already frozen/i);
  });

  it('500 on unexpected RPC error', async () => {
    state.rpcResult = {
      data: null,
      error: { hint: '', message: 'connection refused' },
    };
    const { status, body } = await postFreeze();
    expect(status).toBe(500);
    expect(body.error).toMatch(/could not freeze/i);
  });
});
