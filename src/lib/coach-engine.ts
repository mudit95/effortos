/**
 * AI Coach Engine — determines which nudges to send for each Pro user.
 *
 * Called by /api/cron/coach every hour. For each eligible user, this
 * module checks their local time, task state, streak, goals, and
 * coaching preferences, then returns a list of nudges that should fire.
 */
import type { NudgeType, CoachingIntensity, BotPersona } from '@/types';
import { todayKeyInTz, dateKeyInTz } from '@/lib/user-date';
import { resolvePersona } from '@/lib/persona-tone';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

// ── Nudge schedule: which nudges fire at which hours ──
// The cron runs every hour, so we match against the user's local hour.
const SCHEDULED_NUDGES: Record<string, { hour: number; intensities: CoachingIntensity[] }> = {
  morning_kickoff:      { hour: 8,  intensities: ['light', 'balanced', 'intense'] },
  task_planning_prompt: { hour: 9,  intensities: ['balanced', 'intense'] },
  midday_checkin:       { hour: 13, intensities: ['balanced', 'intense'] },
  streak_protection:    { hour: 19, intensities: ['light', 'balanced', 'intense'] },
  streak_saver:         { hour: 18, intensities: ['light', 'balanced', 'intense'] },
  evening_wrapup:       { hour: 20, intensities: ['light', 'balanced', 'intense'] },
  eod_summary:          { hour: 21, intensities: ['light', 'balanced', 'intense'] },
};

// Weekly recap fires on Sunday at 19:00 for all intensities
const WEEKLY_RECAP_DAY = 0; // Sunday
const WEEKLY_RECAP_HOUR = 19;

// Max nudges per user per day
const MAX_DAILY_NUDGES = 6;

export interface NudgeDecision {
  nudge_type: NudgeType;
  context: UserContext;
}

export interface UserContext {
  userId: string;
  name: string;
  phone: string;
  timezone: string;
  localHour: number;
  localDayOfWeek: number; // 0=Sun
  intensity: CoachingIntensity;
  /** Bot voice (Friend / Mentor / Boss / Colleague). 'friend' if unset. */
  persona: BotPersona;

  // Task state
  totalTasks: number;
  completedTasks: number;
  totalPomsDone: number;
  totalPomsTarget: number;
  taskTitles: string[];
  incompleteTasks: string[];

  // Streak
  currentStreak: number;
  hadSessionToday: boolean;

  // Goals
  activeGoal?: {
    title: string;
    sessionsCompleted: number;
    sessionsCurrent: number;
    pct: number;
    paceStatus?: string;
  };

  // Inactivity
  hoursSinceLastSession: number;

  // Bad day detection
  consecutiveInactiveDays: number;
}

/**
 * For a single Pro user, figure out what nudges should fire this hour.
 * Returns 0 or 1 nudge (never multiple per hour per user).
 */
export async function evaluateNudges(
  supabase: SupabaseClient,
  user: {
    id: string;
    name: string;
    phone_number: string;
    timezone: string;
    coaching_intensity: CoachingIntensity;
    coaching_quiet_start: number;
    coaching_quiet_end: number;
    coaching_paused_until: string | null;
    /** Optional — the chosen WhatsApp bot voice. Falls back to 'friend'. */
    bot_persona?: BotPersona | null;
  },
): Promise<NudgeDecision | null> {
  const tz = user.timezone || 'Asia/Kolkata';
  const now = new Date();

  // Get user's local hour and day
  const localTimeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
  }).format(now);
  const localHour = parseInt(localTimeStr, 10);

  const localDayStr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  }).format(now);
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const localDayOfWeek = dayMap[localDayStr] ?? new Date().getDay();

  // ── Check quiet hours ──
  if (isQuietHour(localHour, user.coaching_quiet_start, user.coaching_quiet_end)) {
    return null;
  }

  // ── Check paused ──
  if (user.coaching_paused_until && new Date(user.coaching_paused_until) > now) {
    return null;
  }

  // ── Check daily nudge cap ──
  const todayKey = todayKeyInTz(tz);
  const { count: nudgesToday } = await supabase
    .from('coach_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', `${todayKey}T00:00:00`)
    .lte('created_at', `${todayKey}T23:59:59`);

  if ((nudgesToday ?? 0) >= MAX_DAILY_NUDGES) {
    return null;
  }

  // ── Gather user context ──
  const ctx = await gatherContext(supabase, user, tz, todayKey, localHour, localDayOfWeek);

  // ── Determine which nudge to send ──

  // 1a. Weekly recap (Sunday 7 PM)
  if (localDayOfWeek === WEEKLY_RECAP_DAY && localHour === WEEKLY_RECAP_HOUR) {
    if (await notSentToday(supabase, user.id, 'weekly_recap', todayKey)) {
      return { nudge_type: 'weekly_recap', context: ctx };
    }
  }

  // 1b. Weekly reflection prompt (Sunday 8 PM) — asks user to journal
  if (localDayOfWeek === WEEKLY_RECAP_DAY && localHour === 20) {
    if (await notSentToday(supabase, user.id, 'weekly_reflection', todayKey)) {
      return { nudge_type: 'weekly_reflection', context: ctx };
    }
  }

  // 2. Bad day detection — 2+ consecutive inactive days
  if (ctx.consecutiveInactiveDays >= 2 && localHour === 10) {
    if (await notSentToday(supabase, user.id, 'bad_day_check', todayKey)) {
      return { nudge_type: 'bad_day_check', context: ctx };
    }
  }

  // 3. Scheduled nudges by hour
  for (const [nudgeType, config] of Object.entries(SCHEDULED_NUDGES)) {
    if (localHour !== config.hour) continue;
    if (!config.intensities.includes(user.coaching_intensity)) continue;

    // Special conditions per nudge type
    if (nudgeType === 'streak_saver') {
      // Only fire if there's a streak to save AND no session today
      if (ctx.currentStreak < 2 || ctx.hadSessionToday) continue;
    }
    if (nudgeType === 'streak_protection') {
      // Only fire if streak >= 3 and NO sessions today — urgent warning
      if (ctx.currentStreak < 3 || ctx.hadSessionToday) continue;
    }
    if (nudgeType === 'task_planning_prompt') {
      // Only fire if user has no tasks for today
      if (ctx.totalTasks > 0) continue;
    }
    if (nudgeType === 'eod_summary') {
      // Only fire if user had tasks today (otherwise nothing to summarize)
      if (ctx.totalTasks === 0) continue;
    }

    if (await notSentToday(supabase, user.id, nudgeType as NudgeType, todayKey)) {
      return { nudge_type: nudgeType as NudgeType, context: ctx };
    }
  }

  // 4. Smart triggers (not tied to specific hours)
  // Idle detection — only during work hours (9 AM–8 PM), only for 'intense' intensity
  if (
    user.coaching_intensity === 'intense' &&
    localHour >= 9 && localHour <= 19 &&
    ctx.hoursSinceLastSession >= 3 &&
    ctx.totalTasks > ctx.completedTasks && // has incomplete tasks
    ctx.hadSessionToday // had at least one session, so they started but went idle
  ) {
    if (await notSentRecently(supabase, user.id, 'idle_detection', 4)) {
      return { nudge_type: 'idle_detection', context: ctx };
    }
  }

  // Goal milestone — check if user just crossed a milestone threshold
  if (ctx.activeGoal) {
    const pct = ctx.activeGoal.pct;
    const milestoneThresholds = [25, 50, 75, 90];
    for (const threshold of milestoneThresholds) {
      if (pct >= threshold && pct < threshold + 5) {
        // Close to a threshold — check if we already celebrated this one
        const { count } = await supabase
          .from('coach_log')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('nudge_type', 'goal_milestone')
          .ilike('context_json->>milestone_pct', `${threshold}`);

        if ((count ?? 0) === 0) {
          return {
            nudge_type: 'goal_milestone',
            context: { ...ctx, activeGoal: { ...ctx.activeGoal, pct: threshold } },
          };
        }
      }
    }

    // Pace warning — falling behind on goal, once per week max
    if (ctx.activeGoal.paceStatus === 'behind') {
      if (await notSentRecently(supabase, user.id, 'pace_warning', 7 * 24)) {
        return { nudge_type: 'pace_warning', context: ctx };
      }
    }
  }

  return null;
}

// ── Helper: gather all context for a user ──
async function gatherContext(
  supabase: SupabaseClient,
  user: {
    id: string;
    name: string;
    phone_number: string;
    coaching_intensity: CoachingIntensity;
    bot_persona?: BotPersona | null;
  },
  tz: string,
  todayKey: string,
  localHour: number,
  localDayOfWeek: number,
): Promise<UserContext> {
  // Tasks
  const { data: tasks } = await supabase
    .from('daily_tasks')
    .select('title, pomodoros_target, pomodoros_done, completed')
    .eq('user_id', user.id)
    .eq('date', todayKey)
    .order('sort_order', { ascending: true });

  const taskList = tasks || [];
  const totalTasks = taskList.length;
  const completedTasks = taskList.filter((t: { completed: boolean }) => t.completed).length;
  const totalPomsDone = taskList.reduce((s: number, t: { pomodoros_done: number }) => s + t.pomodoros_done, 0);
  const totalPomsTarget = taskList.reduce((s: number, t: { pomodoros_target: number }) => s + t.pomodoros_target, 0);
  const taskTitles = taskList.map((t: { title: string }) => t.title);
  const incompleteTasks = taskList
    .filter((t: { completed: boolean }) => !t.completed)
    .map((t: { title: string }) => t.title);

  // Sessions today (for streak/idle detection)
  const { data: todaySessions } = await supabase
    .from('sessions')
    .select('start_time, end_time')
    .eq('user_id', user.id)
    .eq('status', 'completed')
    .gte('start_time', `${todayKey}T00:00:00`)
    .order('start_time', { ascending: false });

  const hadSessionToday = (todaySessions?.length ?? 0) > 0;

  // Hours since last session
  let hoursSinceLastSession = 999;
  if (todaySessions && todaySessions.length > 0) {
    const lastEnd = new Date(todaySessions[0].end_time || todaySessions[0].start_time);
    hoursSinceLastSession = (Date.now() - lastEnd.getTime()) / (1000 * 60 * 60);
  }

  // Streak (count consecutive days with sessions, going backwards)
  let currentStreak = 0;
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const { data: recentSessions } = await supabase
    .from('sessions')
    .select('start_time')
    .eq('user_id', user.id)
    .eq('status', 'completed')
    .gte('start_time', ninetyDaysAgo.toISOString());

  if (recentSessions && recentSessions.length > 0) {
    const sessionDates = new Set(
      recentSessions.map((s: { start_time: string }) =>
        dateKeyInTz(tz, new Date(s.start_time))
      )
    );
    const checkDate = new Date();
    for (let i = 0; i < 90; i++) {
      const dateStr = dateKeyInTz(tz, checkDate);
      if (sessionDates.has(dateStr)) {
        currentStreak++;
      } else if (i > 0) {
        break;
      }
      checkDate.setDate(checkDate.getDate() - 1);
    }
  }

  // Consecutive inactive days (for bad day detection)
  let consecutiveInactiveDays = 0;
  {
    const checkDate = new Date();
    // Start from yesterday (today might still be in progress)
    checkDate.setDate(checkDate.getDate() - 1);
    const sessionDates = new Set(
      (recentSessions || []).map((s: { start_time: string }) =>
        dateKeyInTz(tz, new Date(s.start_time))
      )
    );
    for (let i = 0; i < 7; i++) {
      const dateStr = dateKeyInTz(tz, checkDate);
      if (!sessionDates.has(dateStr)) {
        consecutiveInactiveDays++;
      } else {
        break;
      }
      checkDate.setDate(checkDate.getDate() - 1);
    }
  }

  // Active goal
  const { data: goal } = await supabase
    .from('goals')
    .select('title, sessions_completed, estimated_sessions_current, status')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  let activeGoal: UserContext['activeGoal'];
  if (goal) {
    const pct = goal.estimated_sessions_current > 0
      ? Math.round((goal.sessions_completed / goal.estimated_sessions_current) * 100)
      : 0;
    // Simple pace calculation: ahead if done > expected at this point
    const daysSinceStart = 7; // simplified; real calculation would use goal.created_at
    const expectedPct = Math.min(100, daysSinceStart * 3); // rough heuristic
    const paceStatus = pct >= expectedPct ? 'on_track' : pct >= expectedPct * 0.7 ? 'adjusting' : 'behind';

    activeGoal = {
      title: goal.title,
      sessionsCompleted: goal.sessions_completed,
      sessionsCurrent: goal.estimated_sessions_current,
      pct,
      paceStatus,
    };
  }

  return {
    userId: user.id,
    name: user.name,
    phone: user.phone_number,
    timezone: tz,
    localHour,
    localDayOfWeek,
    intensity: user.coaching_intensity,
    persona: resolvePersona(user.bot_persona),
    totalTasks,
    completedTasks,
    totalPomsDone,
    totalPomsTarget,
    taskTitles,
    incompleteTasks,
    currentStreak,
    hadSessionToday,
    activeGoal,
    hoursSinceLastSession,
    consecutiveInactiveDays,
  };
}

// ── Helper: check if this nudge was already sent today ──
async function notSentToday(
  supabase: SupabaseClient,
  userId: string,
  nudgeType: NudgeType | string,
  todayKey: string,
): Promise<boolean> {
  const { count } = await supabase
    .from('coach_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('nudge_type', nudgeType)
    .gte('created_at', `${todayKey}T00:00:00`)
    .lte('created_at', `${todayKey}T23:59:59`);
  return (count ?? 0) === 0;
}

// ── Helper: check if this nudge was sent within N hours ──
async function notSentRecently(
  supabase: SupabaseClient,
  userId: string,
  nudgeType: NudgeType,
  hours: number,
): Promise<boolean> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('coach_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('nudge_type', nudgeType)
    .gte('created_at', since);
  return (count ?? 0) === 0;
}

// ── Helper: quiet hours check ──
function isQuietHour(hour: number, start: number, end: number): boolean {
  // Handles wrap-around: e.g. start=22, end=7 means 22,23,0,1,...,6 are quiet
  if (start <= end) {
    return hour >= start && hour < end;
  } else {
    return hour >= start || hour < end;
  }
}
