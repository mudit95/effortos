/**
 * EffortOS AI Coach — Core module
 *
 * Provides structured prompts and data formatting for the three AI pillars:
 * 1. Plan My Day — suggests optimal daily tasks
 * 2. Session Debrief — pattern detection after pomodoros
 * 3. Weekly Insights — periodic progress summaries
 */

import type { Goal, DailyTask, Session, FeedbackEntry } from '@/types';

// ─── Types ───────────────────────────────────────────────────────────

export interface CoachContext {
  userName: string;
  timezone: string;
  focusDuration: number; // seconds
  goals: GoalSummary[];
  recentSessions: SessionSummary[];
  todaysTasks: TaskSummary[];
  feedbackHistory: FeedbackEntry[];
  streakDays: number;
  totalLifetimeSessions: number;
}

export interface GoalSummary {
  id: string;
  title: string;
  status: string;
  sessionsCompleted: number;
  sessionsEstimated: number;
  difficulty: string;
  confidenceScore: number;
  daysActive: number;
  deadline?: string;
}

export interface SessionSummary {
  date: string;
  duration: number;
  goalTitle?: string;
  taskTitle?: string;
  notes?: string;
}

export interface TaskSummary {
  title: string;
  tag?: string;
  pomodorosTarget: number;
  pomodorosDone: number;
  completed: boolean;
  repeating: boolean;
}

export interface PlanMyDayRequest {
  context: CoachContext;
  targetDate: string; // YYYY-MM-DD
  existingTasks: TaskSummary[];
}

export interface SessionDebriefRequest {
  context: CoachContext;
  justCompleted: {
    goalTitle?: string;
    taskTitle?: string;
    duration: number;
    sessionNumber: number;
    totalForGoal: number;
    notes?: string;
  };
}

export interface WeeklyInsightRequest {
  context: CoachContext;
  weekSessions: SessionSummary[];
  weekTasks: TaskSummary[];
  previousWeekSessions: number;
}

// ─── System Prompts ──────────────────────────────────────────────────

const COACH_PERSONA = `You are the EffortOS AI Coach — a warm, data-driven productivity partner.

Your personality:
- Encouraging but not cheesy. Think "smart friend who sees patterns you miss."
- Data-informed: always ground advice in the user's actual numbers
- Concise: respect their time. No fluff. Every sentence earns its place.
- Action-oriented: end with something they can DO, not just think about
- Never condescending. Assume they're smart and busy.

Formatting rules:
- Use plain text. No markdown headers or bullet points.
- Keep responses under 150 words unless the user asked for detail.
- Use line breaks to separate distinct thoughts.
- Numbers and metrics should be specific ("12 sessions in 5 days" not "several sessions").`;

export function buildPlanMyDayPrompt(req: PlanMyDayRequest): { system: string; user: string } {
  const { context, targetDate, existingTasks } = req;
  const activeGoals = context.goals.filter(g => g.status === 'active');
  const focusMin = Math.round(context.focusDuration / 60);

  const goalsBlock = activeGoals.map(g => {
    const remaining = Math.max(0, g.sessionsEstimated - g.sessionsCompleted);
    const pct = g.sessionsEstimated > 0 ? Math.round((g.sessionsCompleted / g.sessionsEstimated) * 100) : 0;
    return `- "${g.title}" (${pct}% done, ${remaining} sessions left, ${g.difficulty} difficulty${g.deadline ? `, deadline: ${g.deadline}` : ''})`;
  }).join('\n');

  const recentBlock = context.recentSessions.slice(0, 10).map(s =>
    `  ${s.date}: ${Math.round(s.duration / 60)}min${s.goalTitle ? ` on "${s.goalTitle}"` : ''}${s.taskTitle ? ` — "${s.taskTitle}"` : ''}`
  ).join('\n');

  const existingBlock = existingTasks.length > 0
    ? existingTasks.map(t => `  - "${t.title}" (${t.pomodorosTarget} pomodoros${t.tag ? `, ${t.tag}` : ''}${t.repeating ? ', repeating' : ''})`).join('\n')
    : '  None yet';

  return {
    system: `${COACH_PERSONA}

You are helping plan the user's day. Suggest a realistic set of tasks with pomodoro targets.

Rules:
- Each pomodoro is ${focusMin} minutes of focused work
- Most people can do 4-8 pomodoros in a productive day
- Consider their availability, active goals, and recent patterns
- If they already have tasks, suggest additions/adjustments, don't replace everything
- Include a mix of goal-driven work and maintenance/admin if relevant
- Be specific about task titles — "Write auth middleware" not "Work on project"

Return a JSON object with this structure:
{
  "greeting": "Short personalized greeting (1 sentence)",
  "suggestedTasks": [
    { "title": "specific task name", "pomodoros": 1-4, "tag": "startup|job|learning|personal|health|creative", "reason": "brief reason" }
  ],
  "totalPomodoros": number,
  "estimatedHours": number,
  "insight": "One sentence about their recent pattern or suggestion"
}`,
    user: `Plan ${targetDate === new Date().toISOString().split('T')[0] ? 'today' : targetDate} for ${context.userName}.

Active goals:
${goalsBlock || '  No active goals'}

Recent sessions (last 10):
${recentBlock || '  No recent sessions'}

Already planned for ${targetDate}:
${existingBlock}

Streak: ${context.streakDays} days
Lifetime sessions: ${context.totalLifetimeSessions}`,
  };
}

export function buildSessionDebriefPrompt(req: SessionDebriefRequest): { system: string; user: string } {
  const { context, justCompleted } = req;
  const focusMin = Math.round(context.focusDuration / 60);

  // Calculate patterns from recent sessions
  const recentByGoal: Record<string, number> = {};
  context.recentSessions.forEach(s => {
    if (s.goalTitle) {
      recentByGoal[s.goalTitle] = (recentByGoal[s.goalTitle] || 0) + 1;
    }
  });

  // Feedback bias analysis
  const recentFeedback = context.feedbackHistory.slice(-5);
  const avgBias = recentFeedback.length > 0
    ? recentFeedback.reduce((sum, f) => sum + f.bias, 0) / recentFeedback.length
    : 0;
  const biasDirection = avgBias > 0.3 ? 'underestimating' : avgBias < -0.3 ? 'overestimating' : 'estimating well';

  return {
    system: `${COACH_PERSONA}

The user just completed a ${focusMin}-minute focus session. Give them a brief, encouraging debrief.

Rules:
- Celebrate the effort first (1 sentence)
- If you spot a pattern in their data, mention it (estimation bias, consistency, focus areas)
- Give ONE actionable tip or encouragement for next session
- Keep it to 2-4 sentences total
- Don't ask questions — this should feel like a quick pat on the back with insight

Return a JSON object:
{
  "message": "The debrief message (2-4 sentences, plain text)",
  "pattern": "short label if pattern detected, or null",
  "patternType": "positive|neutral|attention"
}`,
    user: `Session just completed:
- Task: ${justCompleted.taskTitle || 'Unassigned'}
- Goal: ${justCompleted.goalTitle || 'None'}
- Duration: ${Math.round(justCompleted.duration / 60)} minutes
- Session ${justCompleted.sessionNumber} of ${justCompleted.totalForGoal} estimated
${justCompleted.notes ? `- Notes: "${justCompleted.notes}"` : ''}

User context:
- Name: ${context.userName}
- Streak: ${context.streakDays} days
- Estimation tendency: ${biasDirection} (avg bias: ${avgBias.toFixed(1)})
- Sessions this week: ${context.recentSessions.filter(s => {
      const d = new Date(s.date);
      const now = new Date();
      return (now.getTime() - d.getTime()) < 7 * 24 * 60 * 60 * 1000;
    }).length}
- Recent focus distribution: ${Object.entries(recentByGoal).map(([k, v]) => `${k}: ${v}`).join(', ') || 'varied'}`,
  };
}

export function buildWeeklyInsightPrompt(req: WeeklyInsightRequest): { system: string; user: string } {
  const { context, weekSessions, weekTasks, previousWeekSessions } = req;
  const focusMin = Math.round(context.focusDuration / 60);
  const totalMinutes = weekSessions.reduce((sum, s) => sum + s.duration, 0) / 60;
  const totalSessions = weekSessions.length;

  // Goal progress this week
  const goalProgress = context.goals
    .filter(g => g.status === 'active')
    .map(g => {
      const remaining = Math.max(0, g.sessionsEstimated - g.sessionsCompleted);
      const pct = g.sessionsEstimated > 0 ? Math.round((g.sessionsCompleted / g.sessionsEstimated) * 100) : 0;
      return `- "${g.title}": ${pct}% complete, ${remaining} sessions left`;
    }).join('\n');

  // Tag distribution
  const tagDist: Record<string, number> = {};
  weekTasks.forEach(t => {
    const tag = t.tag || 'untagged';
    tagDist[tag] = (tagDist[tag] || 0) + t.pomodorosDone;
  });

  const weekChange = previousWeekSessions > 0
    ? Math.round(((totalSessions - previousWeekSessions) / previousWeekSessions) * 100)
    : 0;

  return {
    system: `${COACH_PERSONA}

Generate a weekly progress summary. Be specific with numbers, warm in tone, and end with one clear suggestion for next week.

Return a JSON object:
{
  "headline": "One punchy sentence summarizing the week (max 10 words)",
  "body": "2-3 sentences with specific metrics, patterns, and encouragement",
  "suggestion": "One specific, actionable suggestion for next week",
  "momentum": "rising|steady|declining"
}`,
    user: `Weekly summary for ${context.userName}:

This week:
- ${totalSessions} sessions completed (${Math.round(totalMinutes)} minutes / ${(totalMinutes / 60).toFixed(1)} hours)
- ${weekChange > 0 ? '+' : ''}${weekChange}% vs last week (${previousWeekSessions} sessions)
- Streak: ${context.streakDays} days

Goal progress:
${goalProgress || '  No active goals'}

Effort by category:
${Object.entries(tagDist).map(([k, v]) => `  ${k}: ${v} pomodoros`).join('\n') || '  No tagged tasks'}

Tasks completed: ${weekTasks.filter(t => t.completed).length} / ${weekTasks.length}
Lifetime total: ${context.totalLifetimeSessions} sessions`,
  };
}
