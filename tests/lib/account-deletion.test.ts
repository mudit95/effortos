/**
 * Coverage for hardDeleteAccount (lib/account-deletion.ts).
 *
 * The 30-day soft-delete cron eventually calls hardDeleteAccount to
 * irreversibly erase a user's data. This test mocks the Supabase service
 * client and asserts that EVERY user-owned table receives a delete with
 * a user_id filter, AND that auth.admin.deleteUser is the very last
 * operation. Regressions here either leak data past the 30-day promise
 * or strand orphaned auth identities.
 *
 * The exact list of tables comes from the function body — keep this in
 * sync when new user-owned tables are added.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hardDeleteAccount } from '@/lib/account-deletion';

const EXPECTED_USER_ID_DELETES = [
  'feedback_entries',
  'sessions',
  'daily_tasks',
  'repeating_templates',
  'timer_state',
  'email_preferences',
  'email_log',
  'coupon_redemptions',
  'journal_entries',
  'shadow_goals',
  'coach_log',
  'other_todos',
  'pacts', // user_id side
  'goals',
  'subscriptions',
];

// Special cases:
//   - milestones uses `.in('goal_id', ...)` not user_id
//   - pacts has TWO writes: a delete on user_id AND an update setting
//     partner_user_id=null on partner_user_id
//   - profiles deletes by `id`, not user_id
const EXPECTED_PROFILE_DELETE = 'profiles';

interface CallLog {
  table: string;
  op: 'delete' | 'update';
  filterKey: string | null;
  filterValue: string | null;
}

describe('hardDeleteAccount', () => {
  let calls: CallLog[];
  let goalIdsReturned: { id: string }[];
  let deleteUserCalled: boolean;
  let deleteUserCalledLast: boolean;

  beforeEach(() => {
    calls = [];
    goalIdsReturned = [{ id: 'g1' }, { id: 'g2' }];
    deleteUserCalled = false;
    deleteUserCalledLast = false;
  });

  function makeChain(table: string) {
    const chain = {
      select: () => ({
        eq: () => ({
          // goals.select('id').eq('user_id', uid) returns the user's goal ids
          // so the function can then run milestones.in('goal_id', ...)
          // The unawaited Promise resolves to { data: goalIdsReturned }.
          then: (cb: (v: { data: { id: string }[] }) => unknown) =>
            Promise.resolve({ data: goalIdsReturned }).then(cb),
        }),
      }),
      delete: () => ({
        eq: (col: string, val: string) => {
          calls.push({ table, op: 'delete', filterKey: col, filterValue: val });
          // Mark "auth deleteUser was last" as broken if a delete happens
          // after auth.admin.deleteUser.
          if (deleteUserCalled) deleteUserCalledLast = false;
          return Promise.resolve({ error: null });
        },
        in: (col: string, vals: string[]) => {
          calls.push({ table, op: 'delete', filterKey: col, filterValue: vals.join(',') });
          if (deleteUserCalled) deleteUserCalledLast = false;
          return Promise.resolve({ error: null });
        },
      }),
      update: (_payload: Record<string, unknown>) => ({
        eq: (col: string, val: string) => {
          calls.push({ table, op: 'update', filterKey: col, filterValue: val });
          if (deleteUserCalled) deleteUserCalledLast = false;
          return Promise.resolve({ error: null });
        },
      }),
    };
    return chain;
  }

  const adminMock = {
    from: (table: string) => makeChain(table),
    auth: {
      admin: {
        deleteUser: vi.fn(async () => {
          deleteUserCalled = true;
          deleteUserCalledLast = true;
          return { error: null };
        }),
      },
    },
  };

  it('runs DELETE on every user-owned table, scoped by user_id', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = await hardDeleteAccount(adminMock as any, 'user-xyz');
    expect(err).toBeNull();

    for (const table of EXPECTED_USER_ID_DELETES) {
      const hit = calls.find(
        (c) => c.table === table && c.op === 'delete' && c.filterKey === 'user_id' && c.filterValue === 'user-xyz',
      );
      expect(hit, `expected DELETE on ${table} with user_id=user-xyz`).toBeTruthy();
    }
  });

  it('clears partner_user_id on the OTHER side of pacts (UPDATE not DELETE)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await hardDeleteAccount(adminMock as any, 'user-xyz');
    const partnerCleanup = calls.find(
      (c) =>
        c.table === 'pacts' &&
        c.op === 'update' &&
        c.filterKey === 'partner_user_id' &&
        c.filterValue === 'user-xyz',
    );
    expect(partnerCleanup).toBeTruthy();
  });

  it('deletes the profile row by id (not user_id)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await hardDeleteAccount(adminMock as any, 'user-xyz');
    const profileDel = calls.find(
      (c) => c.table === EXPECTED_PROFILE_DELETE && c.op === 'delete' && c.filterKey === 'id',
    );
    expect(profileDel).toBeTruthy();
  });

  it('deletes milestones by goal_id (matching the user\'s goals)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await hardDeleteAccount(adminMock as any, 'user-xyz');
    const milestonesDel = calls.find(
      (c) => c.table === 'milestones' && c.op === 'delete' && c.filterKey === 'goal_id',
    );
    expect(milestonesDel).toBeTruthy();
    expect(milestonesDel?.filterValue).toBe('g1,g2');
  });

  it('removes auth.users LAST (after every other table delete)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await hardDeleteAccount(adminMock as any, 'user-xyz');
    expect(deleteUserCalled).toBe(true);
    expect(deleteUserCalledLast).toBe(true);
  });

  it('returns the error message when auth.admin.deleteUser fails', async () => {
    const failingMock = {
      ...adminMock,
      auth: {
        admin: {
          deleteUser: vi.fn(async () => ({ error: { message: 'nope' } })),
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = await hardDeleteAccount(failingMock as any, 'user-xyz');
    expect(err).toContain('nope');
  });
});
