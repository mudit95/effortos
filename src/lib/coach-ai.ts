/**
 * AI Coach Message Generator
 *
 * Takes a nudge type + user context and generates a personalized,
 * human-feeling WhatsApp message via Claude Haiku.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { NudgeType } from '@/types';
import type { UserContext } from '@/lib/coach-engine';
import { personaSystemSnippet, personaGreeting, personaPush } from '@/lib/persona-tone';

const BASE_SYSTEM_PROMPT = `You are the EffortOS AI Coach, a proactive productivity partner that sends WhatsApp messages to help users complete their daily tasks and long-term goals.

RULES:
- Write SHORT, punchy WhatsApp messages (max 300 chars). These are nudges, not essays.
- Use 1-2 emojis max. Don't overdo it.
- Be warm but direct. You're a coach, not a cheerleader.
- Reference the user's ACTUAL data (tasks, streak, goal name, progress %).
- Vary your tone — don't sound robotic or templated.
- Know when to be motivational vs empathetic vs playful.
- NEVER be guilt-trippy or passive-aggressive about missed tasks.
- It's a WhatsApp message — write like a helpful friend, not a corporate notification.
- Return ONLY the message text. No JSON, no markdown, no explanation.

CONTEXT AWARENESS:
- Monday = fresh start energy
- Friday = end-of-week push
- Weekend = lighter, optional feel
- Morning = energizing
- Evening = reflective/grateful
- After streak break = empathetic, no pressure`;

/**
 * Compose the per-message system prompt by appending the persona
 * snippet to the base prompt. We do it per-message rather than caching
 * because the user could change persona at any time (Settings UI), and
 * regenerating the prompt is essentially free.
 */
function systemPromptFor(ctx: UserContext): string {
  return `${BASE_SYSTEM_PROMPT}\n\n${personaSystemSnippet(ctx.persona)}`;
}

const NUDGE_PROMPTS: Record<NudgeType, (ctx: UserContext) => string> = {
  morning_kickoff: (ctx) =>
    `Generate a morning kickoff message for ${ctx.name}.
Today is ${getDayName(ctx.localDayOfWeek)}.
They have ${ctx.totalTasks} tasks planned: ${ctx.taskTitles.join(', ') || 'none yet'}.
Total pomodoros: ${ctx.totalPomsTarget}.
Current streak: ${ctx.currentStreak} days.
${ctx.activeGoal ? `Active goal: "${ctx.activeGoal.title}" at ${ctx.activeGoal.pct}%.` : ''}
Tone: energizing, ready-to-go.`,

  task_planning_prompt: (ctx) =>
    `${ctx.name} hasn't added any tasks for today yet (it's ${getDayName(ctx.localDayOfWeek)} morning).
Current streak: ${ctx.currentStreak} days.
${ctx.activeGoal ? `Active goal: "${ctx.activeGoal.title}" at ${ctx.activeGoal.pct}%.` : ''}
Ask them what they want to work on today. Remind them they can just text their tasks to you.
Tone: casual, inviting — not nagging.`,

  midday_checkin: (ctx) =>
    `Midday check-in for ${ctx.name}.
Progress: ${ctx.completedTasks}/${ctx.totalTasks} tasks done, ${ctx.totalPomsDone}/${ctx.totalPomsTarget} pomodoros.
Remaining tasks: ${ctx.incompleteTasks.join(', ') || 'all done!'}.
${ctx.activeGoal ? `Goal "${ctx.activeGoal.title}": ${ctx.activeGoal.pct}%.` : ''}
Tone: encouraging, suggest what to tackle next.`,

  evening_wrapup: (ctx) =>
    `Evening wrap-up for ${ctx.name}.
Final score: ${ctx.completedTasks}/${ctx.totalTasks} tasks, ${ctx.totalPomsDone}/${ctx.totalPomsTarget} pomodoros.
Streak: ${ctx.currentStreak} days.
${ctx.completedTasks === ctx.totalTasks ? 'They crushed everything!' : `Didn't finish: ${ctx.incompleteTasks.join(', ')}.`}
${ctx.activeGoal ? `Goal "${ctx.activeGoal.title}": ${ctx.activeGoal.pct}%.` : ''}
Tone: reflective, grateful for effort. If they finished everything, celebrate. If not, be kind. End with "Want to plan tomorrow? Just text me your tasks."`,

  streak_saver: (ctx) =>
    `URGENT: ${ctx.name} has a ${ctx.currentStreak}-day streak but hasn't done a session today.
It's 6 PM in their timezone. The streak is at risk!
${ctx.totalTasks > 0 ? `They have ${ctx.totalTasks - ctx.completedTasks} tasks remaining.` : ''}
Tone: motivating but not guilt-trippy. One session can save it.`,

  idle_detection: (ctx) =>
    `${ctx.name} started their day but has been idle for ${Math.round(ctx.hoursSinceLastSession)} hours.
They have ${ctx.incompleteTasks.length} tasks remaining: ${ctx.incompleteTasks.join(', ')}.
Pomodoros: ${ctx.totalPomsDone}/${ctx.totalPomsTarget} done.
Tone: gentle prod, suggest picking up where they left off.`,

  goal_milestone: (ctx) =>
    `${ctx.name} just hit ${ctx.activeGoal?.pct}% on their goal "${ctx.activeGoal?.title}"!
Sessions: ${ctx.activeGoal?.sessionsCompleted}/${ctx.activeGoal?.sessionsCurrent}.
Tone: celebratory! This is a milestone moment. Acknowledge the effort.`,

  weekly_recap: (ctx) =>
    `Generate a Sunday evening weekly recap for ${ctx.name}.
Current streak: ${ctx.currentStreak} days.
Today's tasks: ${ctx.completedTasks}/${ctx.totalTasks} done.
${ctx.activeGoal ? `Goal "${ctx.activeGoal.title}": ${ctx.activeGoal.pct}% (${ctx.activeGoal.sessionsCompleted}/${ctx.activeGoal.sessionsCurrent} sessions).` : 'No active long-term goal.'}
Tone: warm, reflective. Highlight wins, gently note areas for improvement. Look ahead to next week.
Keep it concise — 3-4 short lines max.`,

  pace_warning: (ctx) =>
    `${ctx.name} is falling behind on their goal "${ctx.activeGoal?.title}".
Progress: ${ctx.activeGoal?.pct}% (${ctx.activeGoal?.sessionsCompleted}/${ctx.activeGoal?.sessionsCurrent} sessions).
Tone: supportive, problem-solving. Suggest adding 1 extra session today. Don't be alarmist.`,

  bad_day_check: (ctx) =>
    `${ctx.name} has been inactive for ${ctx.consecutiveInactiveDays} days straight.
Previous streak was ${ctx.currentStreak} days.
Tone: empathetic, zero pressure. Acknowledge that breaks happen. Offer to help when they're ready. DO NOT guilt trip.`,

  welcome: (ctx) =>
    `${ctx.name} just upgraded to EffortOS Pro!
Generate a welcome message explaining what the AI coach does: proactive check-ins 3x daily, streak alerts, weekly recaps, and smart nudges.
Tell them they can text "shh" anytime to pause coaching for 24h, and adjust intensity in Settings.
Tone: warm, excited, helpful.`,

  plan_tomorrow: (ctx) =>
    `${ctx.name} wants to plan tomorrow's tasks via WhatsApp.
Today they completed ${ctx.completedTasks}/${ctx.totalTasks} tasks.
${ctx.activeGoal ? `Active goal: "${ctx.activeGoal.title}" at ${ctx.activeGoal.pct}%.` : ''}
Ask them to list tomorrow's tasks. Remind them of the format: "task name X pomodoros".
Tone: brief, helpful, forward-looking.`,

  eod_summary: (ctx) =>
    `End-of-day summary for ${ctx.name}.
Final score: ${ctx.completedTasks}/${ctx.totalTasks} tasks done, ${ctx.totalPomsDone}/${ctx.totalPomsTarget} pomodoros.
${ctx.incompleteTasks.length > 0 ? `Still open: ${ctx.incompleteTasks.join(', ')}.` : 'Everything done!'}
Streak: ${ctx.currentStreak} days.
${ctx.activeGoal ? `Goal "${ctx.activeGoal.title}": ${ctx.activeGoal.pct}%.` : ''}
Give a brief summary of the day. If there are incomplete tasks, mention they can reply "carry all" to move them to tomorrow. If everything's done, celebrate.
Tone: warm, brief, end-of-day feel. 3-4 lines max.`,

  streak_protection: (ctx) =>
    `STREAK ALERT for ${ctx.name}: They have a ${ctx.currentStreak}-day streak but ZERO sessions today.
It's 7 PM — the day is almost over.
${ctx.totalTasks > 0 ? `They have ${ctx.totalTasks - ctx.completedTasks} unfinished tasks.` : 'No tasks planned today.'}
Tone: urgent but kind. Make it clear one quick pomodoro saves the streak. Don't guilt trip — just state the fact and encourage.
Keep it to 2 lines max. This is a notification, not a conversation.`,

  weekly_reflection: (ctx) =>
    `It's Sunday evening for ${ctx.name}. Send a weekly reflection prompt.
This week: streak is ${ctx.currentStreak} days.
${ctx.activeGoal ? `Goal "${ctx.activeGoal.title}": ${ctx.activeGoal.pct}%.` : ''}
Ask them to share a quick reflection — what went well, what they'd change. Tell them to reply and you'll save it to their journal.
Tone: reflective, calm, Sunday evening vibe. 3 lines max.`,
};

function getDayName(day: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day] || 'today';
}

/**
 * Generate a personalized coach message.
 * Falls back to a static template if AI is unavailable.
 */
export async function generateCoachMessage(
  nudgeType: NudgeType,
  context: UserContext,
): Promise<string> {
  const promptFn = NUDGE_PROMPTS[nudgeType];
  if (!promptFn) {
    return getFallbackMessage(nudgeType, context);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[Coach AI] ANTHROPIC_API_KEY not set — using fallback');
    return getFallbackMessage(nudgeType, context);
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPromptFor(context),
      messages: [{ role: 'user', content: promptFn(context) }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // Sanity check — if AI returns something weird, use fallback
    if (!text || text.length < 10 || text.length > 500) {
      return getFallbackMessage(nudgeType, context);
    }

    return text;
  } catch (err) {
    console.error('[Coach AI] Generation error:', err);
    return getFallbackMessage(nudgeType, context);
  }
}

/**
 * Static fallback messages — used if AI fails or is not configured.
 *
 * The opener and (where natural) sign-off are pulled from the persona
 * helpers so even the no-AI path sounds like the chosen voice. The
 * informational middle stays the same regardless of persona — it's
 * factual data (counts, streaks, goal names).
 */
function getFallbackMessage(nudgeType: NudgeType, ctx: UserContext): string {
  const greet = personaGreeting(ctx.persona, ctx.name); // e.g. "Yo Mudit"
  const push = personaPush(ctx.persona);                // e.g. "Let's gooo 🚀"

  switch (nudgeType) {
    case 'morning_kickoff':
      return `☀️ ${greet}! You have ${ctx.totalTasks} tasks and ${ctx.totalPomsTarget} pomodoros planned today. ${push}`;
    case 'task_planning_prompt':
      return `📋 ${greet} — no tasks planned yet today. What do you want to work on? Just text me your tasks.`;
    case 'midday_checkin':
      return `🔥 Halfway check: ${ctx.completedTasks}/${ctx.totalTasks} tasks done, ${ctx.totalPomsDone}/${ctx.totalPomsTarget} pomodoros. ${push}`;
    case 'evening_wrapup':
      return ctx.completedTasks === ctx.totalTasks
        ? `🎉 ${greet} — clean sweep! ${ctx.totalTasks} tasks, all done. ${ctx.currentStreak}-day streak! Want to plan tomorrow?`
        : `🌙 Day's wrapping up — ${ctx.completedTasks}/${ctx.totalTasks} tasks done. Solid effort. Want to plan tomorrow?`;
    case 'streak_saver':
      return `🔥 ${greet} — your ${ctx.currentStreak}-day streak is at risk. One focused session keeps it alive.`;
    case 'idle_detection':
      return `⏰ Been a while since your last session. ${ctx.incompleteTasks.length} tasks waiting — pick one and run a quick pomodoro?`;
    case 'goal_milestone':
      return `🎯 ${greet} — you hit ${ctx.activeGoal?.pct}% on "${ctx.activeGoal?.title}". Real progress. ${push}`;
    case 'weekly_recap':
      return `📊 Weekly recap: ${ctx.currentStreak}-day streak.${ctx.activeGoal ? ` "${ctx.activeGoal.title}" is at ${ctx.activeGoal.pct}%.` : ''} ${push}`;
    case 'pace_warning':
      return `📎 Heads up on "${ctx.activeGoal?.title}" — you're a bit behind pace. Adding 1 extra session today could get you back on track.`;
    case 'bad_day_check':
      // Empathy line — keep it consistent across personas; no push.
      return `${greet} 👋 — haven't seen you in a few days. Totally fine, everyone needs a break. I'm here whenever you're ready.`;
    case 'welcome':
      return `🎉 Welcome to EffortOS Pro, ${ctx.name}! I'll check in with you throughout the day to keep you on track. Text "shh" anytime to pause coaching for 24h.`;
    case 'plan_tomorrow':
      return `📝 Let's plan tomorrow. Text your tasks like: "Review docs 2 pomodoros, team meeting prep, design mockups 3 poms".`;
    case 'eod_summary':
      return ctx.incompleteTasks.length > 0
        ? `🌙 Day done: ${ctx.completedTasks}/${ctx.totalTasks} tasks, ${ctx.totalPomsDone} pomodoros. ${ctx.incompleteTasks.length} still open — reply "carry all" to move them to tomorrow.`
        : `🌙 ${greet} — clean sweep! ${ctx.totalTasks} tasks all done. ${ctx.currentStreak}-day streak. Rest up.`;
    case 'streak_protection':
      return `🔥 Heads up ${ctx.name} — your ${ctx.currentStreak}-day streak is at risk. No sessions today. Even one quick pomodoro saves it.`;
    case 'weekly_reflection':
      return `📓 Sunday reflection: what went well this week, what would you change? Reply and I'll save it to your journal.`;
  }
}

// ── Wave 3: Daily AI report card ─────────────────────────────────────────
//
// One-line prescriptive suggestion sent to Pro users at end-of-day.
// Distinct from the existing nightly email (which is descriptive). This
// is the "what should I do differently tomorrow" line, fed by today's
// numbers and the user's longer-running pattern.
//
// Cached one-per-(user, date) in the daily_cards table (mig 037), so
// the dashboard render doesn't re-fire Claude. The endpoint
// (/api/coach/daily-card) handles cache lookup + write.

/** Stats shape the daily-card AI uses. Mirrors the JSONB schema in
 *  the daily_cards table; keeping the types together makes the
 *  contract obvious at the call site. */
export interface DailyCardStats {
  focusMinutes: number;
  sessionsCompleted: number;
  tasksCompleted: number;
  tasksTotal: number;
  /** 0..1, NaN when tasksTotal == 0 (renderer should hide). */
  completionRate: number;
  /** Latest journal mood if the user logged one today, else null. */
  mood: string | null;
  currentStreak: number;
  /** Active goal pace as % complete, NULL when no active goal. */
  activeGoalPct: number | null;
  /** User's first name, used for the personalisation in the prompt. */
  userName: string;
}

/** Result tuple from the AI call. tokens=0 when fallback was used
 *  (no Claude call happened) — caller can record that for accounting. */
export interface DailyCardAiResult {
  suggestion: string;
  tokens: number;
}

const DAILY_CARD_SYSTEM = `You are EffortOS, generating a one-line evening insight for a user reviewing their day.

OUTPUT RULES:
- Return EXACTLY one sentence. Max 140 characters. No bullets, no preamble, no markdown.
- Be prescriptive ("try X tomorrow"), not descriptive (the dashboard already shows numbers).
- Reference SPECIFIC numbers from CONTEXT only when they support the suggestion. Never invent stats.
- Tone: warm, grounded, non-pushy. Like a thoughtful colleague, not a coach hyping you up.
- If today went well, reinforce the pattern ("today's 3 sessions before noon were your best — same shape tomorrow?").
- If today went sideways, suggest one small recoverable change ("tomorrow, lock in just one 25-min block before lunch").
- Avoid praise inflation. "Great job!" / "Amazing!" — never write those words.
- No emojis. The dashboard handles visual styling.`;

export async function generateDailyCardAi(
  stats: DailyCardStats,
): Promise<DailyCardAiResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { suggestion: dailyCardFallback(stats), tokens: 0 };
  }

  const ctxLines: string[] = [
    `User: ${stats.userName.split(' ')[0] || 'there'}`,
    `Focus minutes today: ${stats.focusMinutes}`,
    `Sessions completed: ${stats.sessionsCompleted}`,
    `Tasks: ${stats.tasksCompleted}/${stats.tasksTotal} complete`,
    `Streak: ${stats.currentStreak} days`,
  ];
  if (stats.mood) ctxLines.push(`Today's journal mood: ${stats.mood}`);
  if (stats.activeGoalPct != null) {
    ctxLines.push(`Active goal: ${stats.activeGoalPct}% complete`);
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: DAILY_CARD_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `[CONTEXT]\n${ctxLines.join('\n')}\n\n[TASK]\nWrite the one-line insight.`,
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // Shape sanity: must be a single sentence, reasonable length.
    // Anthropic occasionally adds trailing whitespace or a stray
    // markdown wrapper despite the prompt — strip + bound.
    const cleaned = text
      .replace(/^[`*_>\s]+|[`*_>\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned || cleaned.length < 20 || cleaned.length > 240) {
      return { suggestion: dailyCardFallback(stats), tokens: response.usage?.input_tokens ?? 0 };
    }

    const totalTokens =
      (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
    return { suggestion: cleaned, tokens: totalTokens };
  } catch (err) {
    console.error('[daily-card-ai] generation failed:', err);
    return { suggestion: dailyCardFallback(stats), tokens: 0 };
  }
}

/** Static fallback when AI is unavailable. Picks a line based on
 *  whether today went well or poorly so the suggestion still feels
 *  responsive to the user's actual numbers. */
function dailyCardFallback(stats: DailyCardStats): string {
  const completed = stats.tasksCompleted;
  const total = stats.tasksTotal;
  const cleanSweep = total > 0 && completed === total;
  const lateStart = stats.focusMinutes < 25;

  if (cleanSweep) {
    return 'Clean sweep today — try the same first-block timing tomorrow to lock the pattern in.';
  }
  if (lateStart && total > 0) {
    return 'Tomorrow, try locking in just one 25-minute block before lunch — that anchors the rest of the day.';
  }
  if (total === 0) {
    return 'No tasks today — set 1-3 small ones tonight so tomorrow starts with a clear first move.';
  }
  return 'Carry one unfinished task into tomorrow as your first focus block — momentum beats blank slate.';
}
