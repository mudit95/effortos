/**
 * AI Coach Message Generator
 *
 * Takes a nudge type + user context and generates a personalized,
 * human-feeling WhatsApp message via Claude Haiku.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { NudgeType } from '@/types';
import type { UserContext } from '@/lib/coach-engine';

const SYSTEM_PROMPT = `You are the EffortOS AI Coach, a proactive productivity partner that sends WhatsApp messages to help users complete their daily tasks and long-term goals.

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
      system: SYSTEM_PROMPT,
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
 */
function getFallbackMessage(nudgeType: NudgeType, ctx: UserContext): string {
  switch (nudgeType) {
    case 'morning_kickoff':
      return `☀️ Good morning ${ctx.name}! You have ${ctx.totalTasks} tasks and ${ctx.totalPomsTarget} pomodoros planned today. Let's make it count!`;
    case 'task_planning_prompt':
      return `📋 Hey ${ctx.name}, no tasks planned yet today. What do you want to work on? Just text me your tasks!`;
    case 'midday_checkin':
      return `🔥 Halfway check: ${ctx.completedTasks}/${ctx.totalTasks} tasks done, ${ctx.totalPomsDone}/${ctx.totalPomsTarget} pomodoros. Keep it up!`;
    case 'evening_wrapup':
      return ctx.completedTasks === ctx.totalTasks
        ? `🎉 ${ctx.name}, you crushed it today! ${ctx.totalTasks} tasks, all done. ${ctx.currentStreak}-day streak! Want to plan tomorrow?`
        : `🌙 Day's wrapping up — ${ctx.completedTasks}/${ctx.totalTasks} tasks done. Solid effort! Want to plan tomorrow? Just text me.`;
    case 'streak_saver':
      return `🔥 ${ctx.name}, your ${ctx.currentStreak}-day streak is at risk! One focused session keeps it alive. You've got this!`;
    case 'idle_detection':
      return `⏰ Been a while since your last session. ${ctx.incompleteTasks.length} tasks waiting — pick one and do a quick pomodoro?`;
    case 'goal_milestone':
      return `🎯 Amazing — you hit ${ctx.activeGoal?.pct}% on "${ctx.activeGoal?.title}"! That's real progress. Keep going! 💪`;
    case 'weekly_recap':
      return `📊 Weekly recap: ${ctx.currentStreak}-day streak.${ctx.activeGoal ? ` "${ctx.activeGoal.title}" is at ${ctx.activeGoal.pct}%.` : ''} Great week — let's make next one even better!`;
    case 'pace_warning':
      return `📎 Heads up on "${ctx.activeGoal?.title}" — you're a bit behind pace. Adding 1 extra session today could get you back on track.`;
    case 'bad_day_check':
      return `Hey ${ctx.name} 👋 Haven't seen you in a few days — totally fine, everyone needs a break. Whenever you're ready, I'm here. No pressure.`;
    case 'welcome':
      return `🎉 Welcome to EffortOS Pro, ${ctx.name}! I'll check in with you throughout the day to keep you on track. Text "shh" anytime to pause coaching for 24h.`;
    case 'plan_tomorrow':
      return `📝 Let's plan tomorrow! Just text me your tasks like: "Review docs 2 pomodoros, team meeting prep, design mockups 3 poms"`;
  }
}
