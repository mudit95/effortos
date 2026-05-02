/**
 * Coverage for getStreaksWithFreezes — the freeze-aware streak math
 * that powers the Wave 2 retention feature.
 *
 * The contract (per STREAK_FREEZES_DESIGN.md):
 *   - A freeze covers a calendar day so the streak walks past it.
 *   - A freeze on a day that already has a session is a no-op.
 *   - A run that's ONLY freezes (no real sessions) doesn't count
 *     as a streak — otherwise users could fabricate streaks with
 *     pure tokens and undermine the activity signal.
 *   - Both `current` (walk back from today) and `longest` (scan all
 *     known days) honour the freeze rule equally.
 */

import { describe, it, expect } from 'vitest';
import { getStreaksWithFreezes } from '@/lib/utils';

// All tests pin the "today" anchor explicitly so they don't drift
// against real wall clock — keeps the suite deterministic.
const TODAY = '2026-05-01';

// Sessions are typed as { date, count }; we only ever set count > 0
// for "real session" days. count === 0 is equivalent to absence.
function s(date: string, count = 1) {
  return { date, count };
}

describe('getStreaksWithFreezes — basic regressions (no freezes)', () => {
  it('returns 0/0 for empty inputs', () => {
    const out = getStreaksWithFreezes([], new Set(), TODAY);
    expect(out).toEqual({ current: 0, longest: 0 });
  });

  it('counts a single session today as a 1/1 streak', () => {
    const out = getStreaksWithFreezes([s(TODAY)], new Set(), TODAY);
    expect(out.current).toBe(1);
    expect(out.longest).toBe(1);
  });

  it('breaks the current streak when today has no session and no freeze', () => {
    const out = getStreaksWithFreezes(
      [s('2026-04-30'), s('2026-04-29')],
      new Set(),
      TODAY,
    );
    expect(out.current).toBe(0);
    expect(out.longest).toBe(2);
  });

  it('counts a 5-day contiguous run with no gaps', () => {
    const days = ['2026-04-27', '2026-04-28', '2026-04-29', '2026-04-30', TODAY];
    const out = getStreaksWithFreezes(days.map((d) => s(d)), new Set(), TODAY);
    expect(out.current).toBe(5);
    expect(out.longest).toBe(5);
  });
});

describe('getStreaksWithFreezes — freeze covers gaps', () => {
  it('a freeze in the middle bridges a missed day', () => {
    // Sessions: today, 4/30, 4/28. Missing 4/29. Freeze on 4/29.
    // Expected: 4/28 → 4/29 (freeze) → 4/30 → today = 4-day current streak.
    const sessions = [s(TODAY), s('2026-04-30'), s('2026-04-28')];
    const freezes = new Set(['2026-04-29']);
    const out = getStreaksWithFreezes(sessions, freezes, TODAY);
    expect(out.current).toBe(4);
    expect(out.longest).toBe(4);
  });

  it('a freeze on today preserves the streak when no session today', () => {
    // User went to bed, midnight cron auto-applied a freeze. Sessions
    // exist for 4/30 and 4/29. Today is freeze-only. Streak continues.
    const sessions = [s('2026-04-30'), s('2026-04-29')];
    const freezes = new Set([TODAY]);
    const out = getStreaksWithFreezes(sessions, freezes, TODAY);
    expect(out.current).toBe(3);
    expect(out.longest).toBe(3);
  });

  it('multiple freezes can bridge multiple gaps', () => {
    // Sessions on 4/26, 4/29, today. Freezes on 4/27 and 4/28.
    // Expected: 4/26 → freeze → freeze → 4/29 → break (4/30 missing) → today
    // From today walking back: today (real) → 4/30 missing → break.
    // So current = 1 (just today). Longest is 4/26→4/27(f)→4/28(f)→4/29 = 4.
    const sessions = [s(TODAY), s('2026-04-29'), s('2026-04-26')];
    const freezes = new Set(['2026-04-27', '2026-04-28']);
    const out = getStreaksWithFreezes(sessions, freezes, TODAY);
    expect(out.current).toBe(1);
    expect(out.longest).toBe(4);
  });

  it('a freeze on a day that already has a session is a no-op', () => {
    // Should NOT inflate the count past the actual contiguous run length.
    const sessions = [s(TODAY), s('2026-04-30')];
    const freezes = new Set([TODAY, '2026-04-30']); // overlap with sessions
    const out = getStreaksWithFreezes(sessions, freezes, TODAY);
    expect(out.current).toBe(2);
    expect(out.longest).toBe(2);
  });

  it('freeze-only run with no real sessions does NOT qualify as a streak', () => {
    // A user who never logged a session but consumed freezes: streak
    // is 0/0. Otherwise users could fake activity entirely with tokens.
    const out = getStreaksWithFreezes([], new Set([TODAY, '2026-04-30']), TODAY);
    expect(out.current).toBe(0);
    expect(out.longest).toBe(0);
  });

  it('current run with freeze on today AND zero real sessions in the run does not count', () => {
    // Edge case: freezes immediately preceding today, today is also a
    // freeze, NO real sessions anywhere. Should stay 0.
    const out = getStreaksWithFreezes(
      [],
      new Set([TODAY, '2026-04-30', '2026-04-29']),
      TODAY,
    );
    expect(out.current).toBe(0);
    expect(out.longest).toBe(0);
  });
});

describe('getStreaksWithFreezes — longest streak math', () => {
  it('finds the longest run when there are multiple disconnected runs', () => {
    // Run 1: 4/01-4/05 (5 days)  Run 2: 4/15-4/17 (3 days, today)
    const days = [
      '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05',
      '2026-04-15', '2026-04-16', '2026-04-17',
    ];
    // Need today anchor that's >= the latest day so current = run2 length.
    const out = getStreaksWithFreezes(days.map((d) => s(d)), new Set(), '2026-04-17');
    expect(out.current).toBe(3);
    expect(out.longest).toBe(5);
  });

  it('a freeze that bridges two short runs combines them into a longer one', () => {
    // Run 1 sessions: 4/01-4/03 (3 days)
    // Run 2 sessions: 4/05-4/06 (2 days)
    // Freeze on 4/04 → bridges them into 4/01-4/06 (6 days)
    const sessions = [
      s('2026-04-01'), s('2026-04-02'), s('2026-04-03'),
      s('2026-04-05'), s('2026-04-06'),
    ];
    const freezes = new Set(['2026-04-04']);
    const out = getStreaksWithFreezes(sessions, freezes, '2026-04-06');
    expect(out.longest).toBe(6);
    expect(out.current).toBe(6);
  });

  it('two-day gap with one freeze and one missing day still breaks the run', () => {
    // Sessions: 4/01, 4/04. Freeze on 4/02. Missing 4/03 entirely.
    // Two separate runs: 4/01→4/02(f) = 2 days, then 4/04 = 1 day.
    const sessions = [s('2026-04-01'), s('2026-04-04')];
    const freezes = new Set(['2026-04-02']);
    const out = getStreaksWithFreezes(sessions, freezes, '2026-04-04');
    expect(out.current).toBe(1); // just 4/04
    expect(out.longest).toBe(2); // 4/01 + 4/02 freeze
  });
});
