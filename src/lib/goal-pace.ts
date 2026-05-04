/**
 * Goal pace projection.
 *
 * Given a goal's history (sessions completed + when it was created)
 * and its target (estimated_sessions_current), project the date the
 * user will hit 100% completion at the current rolling pace.
 *
 * The projection is intentionally simple: linear extrapolation from
 * the last 14 days of session count. We considered weighted moving
 * averages and goal-specific seasonality, but the simpler model is
 * easier to explain ("at this rate you'll finish on...") and the
 * confidence interval on a 14-day window is tight enough that the
 * simple version doesn't mislead users in practice.
 *
 * Confidence:
 *   - 'high'    : ≥10 sessions over the last 14 days, deadline is
 *                 within 6 months
 *   - 'medium'  : ≥4 sessions over the last 14 days
 *   - 'low'     : <4 sessions; we still project but flag it
 *
 * Pace status:
 *   - 'on_track': projected completion within 7 days of the user's
 *                 deadline (or no deadline set)
 *   - 'ahead'   : projected ≥7 days BEFORE the deadline
 *   - 'behind'  : projected ≥7 days AFTER the deadline
 *
 * Returns null when the goal has zero sessions (nothing to project)
 * or when the user has no recent activity at all (would project to
 * "never").
 */

export interface PaceProjection {
  /** ISO date of projected completion (YYYY-MM-DD). */
  projectedDate: string;
  /** Days from today to projection. Negative if already past target. */
  daysFromNow: number;
  /** Pace category for tone-tuning the surfaced copy. */
  status: 'on_track' | 'ahead' | 'behind';
  /** How much we trust the number — drives whether to render an
   *  emphatic "you'll finish on Y" or a softer "if you keep this up". */
  confidence: 'high' | 'medium' | 'low';
  /** Average sessions per day over the last 14 days (for tooltip). */
  recentDailyRate: number;
}

interface GoalLike {
  estimated_sessions_current: number;
  sessions_completed: number;
  deadline?: string | null;
}

interface SessionLike {
  start_time?: string | null;
  status?: string;
}

const ROLLING_WINDOW_DAYS = 14;
const PACE_TOLERANCE_DAYS = 7;

export function projectGoalPace(
  goal: GoalLike,
  sessions: SessionLike[],
): PaceProjection | null {
  const remaining = Math.max(0, goal.estimated_sessions_current - goal.sessions_completed);
  if (remaining === 0) return null; // already done
  if (goal.sessions_completed === 0) return null; // nothing to extrapolate from

  const cutoff = Date.now() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recentSessions = sessions.filter(
    (s) => s.status === 'completed' && s.start_time && new Date(s.start_time).getTime() >= cutoff,
  );
  const recentCount = recentSessions.length;
  if (recentCount === 0) return null; // dormant; don't project a "never" date

  const dailyRate = recentCount / ROLLING_WINDOW_DAYS;
  const daysToCompletion = Math.ceil(remaining / dailyRate);
  // Cap projection at 5 years out — anything longer is a "set it
  // realistically" signal, not a useful date.
  const cappedDays = Math.min(daysToCompletion, 365 * 5);

  const projected = new Date();
  projected.setHours(0, 0, 0, 0);
  projected.setDate(projected.getDate() + cappedDays);
  const projectedDate = projected.toISOString().slice(0, 10);

  // Pace status: compare to deadline if set.
  let status: PaceProjection['status'] = 'on_track';
  if (goal.deadline) {
    const deadlineMs = new Date(goal.deadline).getTime();
    const projectedMs = projected.getTime();
    const diffDays = Math.round((projectedMs - deadlineMs) / (24 * 60 * 60 * 1000));
    if (diffDays > PACE_TOLERANCE_DAYS) status = 'behind';
    else if (diffDays < -PACE_TOLERANCE_DAYS) status = 'ahead';
  }

  // Confidence: more recent activity + sane projection horizon = higher.
  let confidence: PaceProjection['confidence'] = 'low';
  if (recentCount >= 10 && cappedDays <= 180) confidence = 'high';
  else if (recentCount >= 4) confidence = 'medium';

  return {
    projectedDate,
    daysFromNow: cappedDays,
    status,
    confidence,
    recentDailyRate: Number(dailyRate.toFixed(2)),
  };
}

/** Format a projection date as "Jun 14" / "Jun 14, 2027". */
export function formatProjectedDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
