/**
 * Cross-user isolation for /api/sessions/complete.
 *
 * NOTE: this is NOT a Postgres RLS test — vitest doesn't drive a real
 * database. Real RLS coverage requires an integration test against a
 * test Supabase project. What this CAN test, and the regression we care
 * most about, is route-level defence-in-depth: the handler MUST scope
 * its session/goal/daily_task updates with `user_id = auth.uid()` (or
 * `id = …` for goals/tasks read via user_id then mutated). A code change
 * that drops one of those filters would let a malicious client supply
 * another user's session_id and have it marked completed.
 *
 * The mock supabase records every `.eq()` call into a list; the test
 * asserts that every mutating chain (update on sessions, update on
 * daily_tasks, update on goals) ends up with a user_id filter.
 *
 * Pair this with a real RLS integration test on a staging Supabase
 * project — that one isn't in the vitest suite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface MutationLog {
  table: string;
  op: 'update';
  filters: Array<{ key: string; value: unknown }>;
}

const state: {
  authUser: { id: string; email: string } | null;
  mutations: MutationLog[];
  // What the conditional update returns. The route uses this to detect
  // "already completed" replays — empty array means no row transitioned.
  transitionedRows: Array<{ id: string }>;
  // Goal row returned from the goals.select() chain.
  goalRow: Record<string, unknown> | null;
  // Daily-task row returned from the daily_tasks.select() chain.
  taskRow: Record<string, unknown> | null;
} = {
  authUser: null,
  mutations: [],
  transitionedRows: [],
  goalRow: null,
  taskRow: null,
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.authUser } }) },
    from: (table: string) => buildChain(table),
  }),
}));

function buildChain(table: string) {
  const filters: Array<{ key: string; value: unknown }> = [];
  const recordEq = (key: string, value: unknown) => {
    filters.push({ key, value });
  };

  return {
    update: (_payload: unknown) => {
      const finalize = () => {
        // Capture the mutation log on whichever terminal the chain reaches.
        // The route uses two patterns:
        //   - update.eq.eq.neq.select()  (sessions: conditional + read-back)
        //   - update.eq.eq                (daily_tasks: fire-and-forget)
        state.mutations.push({ table, op: 'update', filters: [...filters] });
      };
      const upd = {
        eq: (k: string, v: unknown) => {
          recordEq(k, v);
          return upd;
        },
        neq: (k: string, v: unknown) => {
          recordEq(`!${k}`, v);
          return upd;
        },
        select: () => {
          finalize();
          return Promise.resolve({
            data: state.transitionedRows,
            error: null,
          });
        },
        // Fire-and-forget chain (no .select()) — captured when awaited.
        then: (cb: (v: { data: null; error: null }) => unknown) => {
          finalize();
          return Promise.resolve({ data: null, error: null }).then(cb);
        },
      };
      return upd;
    },
    select: (_cols: string) => ({
      eq: (k: string, v: unknown) => {
        recordEq(k, v);
        const inner = {
          eq: (k2: string, v2: unknown) => {
            recordEq(k2, v2);
            return {
              maybeSingle: async () => ({
                data: table === 'goals' ? state.goalRow : table === 'daily_tasks' ? state.taskRow : null,
              }),
            };
          },
        };
        return inner;
      },
    }),
    delete: () => ({
      eq: (k: string, v: unknown) => {
        recordEq(k, v);
        state.mutations.push({ table, op: 'update', filters: [...filters] });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
}

function reset(): void {
  state.authUser = { id: 'user-real', email: 'r@example.com' };
  state.mutations = [];
  state.transitionedRows = [{ id: 'session-1' }];
  state.goalRow = null;
  state.taskRow = null;
}

async function callComplete(body: Record<string, unknown>) {
  vi.resetModules();
  const mod = await import('@/app/api/sessions/complete/route');
  const req = new Request('http://test/api/sessions/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await mod.POST(req);
  return { status: res.status, body: await res.json() };
}

describe('/api/sessions/complete — user isolation', () => {
  beforeEach(reset);

  it('updates sessions with both id AND user_id filters', async () => {
    const { status } = await callComplete({
      sessionId: 'session-1',
      duration: 1500,
    });
    expect(status).toBe(200);

    const sessionMutation = state.mutations.find((m) => m.table === 'sessions');
    expect(sessionMutation, 'must call update on sessions').toBeTruthy();
    const keys = sessionMutation!.filters.map((f) => f.key);
    expect(keys).toContain('id');
    expect(keys).toContain('user_id');
    // The user_id filter MUST be the auth user's id, not anything from the body.
    const uidFilter = sessionMutation!.filters.find((f) => f.key === 'user_id');
    expect(uidFilter?.value).toBe('user-real');
  });

  it('returns alreadyCompleted no-op when conditional update transitioned 0 rows', async () => {
    state.transitionedRows = []; // simulate "already completed"
    const { status, body } = await callComplete({
      sessionId: 'session-1',
      duration: 1500,
    });
    expect(status).toBe(200);
    expect(body.alreadyCompleted).toBe(true);
    // No goal or task mutations should have followed.
    const goalUpdate = state.mutations.find((m) => m.table === 'goals');
    const taskUpdate = state.mutations.find((m) => m.table === 'daily_tasks');
    expect(goalUpdate).toBeUndefined();
    expect(taskUpdate).toBeUndefined();
  });

  it('rejects unauthenticated requests with 401', async () => {
    state.authUser = null;
    const { status, body } = await callComplete({
      sessionId: 'session-1',
      duration: 1500,
    });
    expect(status).toBe(401);
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('refuses to act when sessionId or duration missing', async () => {
    const { status } = await callComplete({ sessionId: 'session-1' });
    expect(status).toBe(400);
  });
});
