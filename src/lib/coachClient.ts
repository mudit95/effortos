/**
 * Client-side helpers that call the Coach API routes and
 * transform store data into the shapes coach.ts expects.
 */

import type { CoachContext, PlanMyDayRequest, SessionDebriefRequest, WeeklyInsightRequest, GoalSummary, SessionSummary, TaskSummary } from './coach';
import type { Goal, Session, DailyTask, FeedbackEntry, User } from '@/types';

// ─── Response types ──────────────────────────────────────────────────

export interface PlanMyDayResponse {
  greeting: string;
  suggestedTasks: {
    title: string;
    pomodoros: number;
    tag: string;
    reason: string;
    goal_id?: string;
    isGoalWork?: boolean;
  }[];
  totalPomodoros: number;
  estimatedHours: number;
  insight: string;
  deadlineWarnings?: string[];
}

export interface SessionDebriefResponse {
  message: string;
  pattern: string | null;
  patternType: 'positive' | 'neutral' | 'attention';
}

export interface WeeklyInsightResponse {
  headline: string;
  body: string;
  suggestion: string;
  momentum: 'rising' | 'steady' | 'declining';
}

// ─── Context builder ─────────────────────────────────────────────────

export function buildCoachContext(
  user: User,
  goals: Goal[],
  sessions: Session[],
  dailyTasks: DailyTask[],
): CoachContext {
  const focusDuration = user.settings?.focus_duration || 25 * 60;

  const goalSummaries: GoalSummary[] = goals.map(g => ({
    id: g.id,
    title: g.title,
    status: g.status,
    sessionsCompleted: g.sessions_completed,
    sessionsEstimated: g.estimated_sessions_current,
    difficulty: g.difficulty || 'medium',
    confidenceScore: g.confidence_score || 0.5,
    daysActive: Math.ceil((Date.now() - new Date(g.created_at).getTime()) / (1000 * 60 * 60 * 24)),
    deadline: g.deadline || undefined,
  }));

  const recentSessions: SessionSummary[] = sessions
    .filter(s => s.status === 'completed')
    .sort((a, b) => new Date(b.end_time || b.start_time).getTime() - new Date(a.end_time || a.start_time).getTime())
    .slice(0, 20)
    .map(s => ({
      date: (s.end_time || s.start_time).split('T')[0],
      duration: s.duration || focusDuration,
      goalTitle: goals.find(g => g.id === s.goal_id)?.title,
      notes: s.notes || undefined,
    }));

  const todaysTasks: TaskSummary[] = dailyTasks.map(t => ({
    title: t.title,
    tag: t.tag || undefined,
    pomodorosTarget: t.pomodoros_target,
    pomodorosDone: t.pomodoros_done,
    completed: t.completed,
    repeating: t.repeating || false,
  }));

  // Calculate streak
  const sessionDates = [...new Set(
    sessions
      .filter(s => s.status === 'completed')
      .map(s => (s.end_time || s.start_time).split('T')[0])
  )].sort().reverse();

  let streakDays = 0;
  const today = new Date().toISOString().split('T')[0];
  let checkDate = today;
  for (const d of sessionDates) {
    if (d === checkDate || d === getPrevDay(checkDate)) {
      streakDays++;
      checkDate = d;
    } else break;
  }

  return {
    userName: user.name || 'there',
    timezone: user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    focusDuration,
    goals: goalSummaries,
    recentSessions,
    todaysTasks,
    feedbackHistory: (goals[0] as Goal & { feedback_bias_log?: FeedbackEntry[] })?.feedback_bias_log || [],
    streakDays,
    totalLifetimeSessions: sessions.filter(s => s.status === 'completed').length,
  };
}

function getPrevDay(dateStr: string): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// ─── API callers ─────────────────────────────────────────────────────

export async function fetchPlanMyDay(req: PlanMyDayRequest): Promise<PlanMyDayResponse> {
  const res = await fetch('/api/coach/plan-day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchSessionDebrief(req: SessionDebriefRequest): Promise<SessionDebriefResponse> {
  const res = await fetch('/api/coach/session-debrief', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchWeeklyInsight(req: WeeklyInsightRequest): Promise<WeeklyInsightResponse> {
  const res = await fetch('/api/coach/weekly-insight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
