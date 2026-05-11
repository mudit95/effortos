/**
 * WhatsApp companion nudges for the daily email crons.
 *
 * Each of /api/cron/{morning,afternoon,nightly}-email already builds a per-user
 * payload and sends an email. After a successful send they call
 * `sendCronNudge` which mirrors the same data into a short WhatsApp message —
 * but only if the user is opted in *and* not currently in a quiet/pause window.
 *
 * Design rules:
 *   1. Best-effort: a WhatsApp failure must NEVER make the email cron fail.
 *      Every fetch is wrapped, and errors are logged + swallowed.
 *   2. Piggyback on email opt-in: the cron already filtered for
 *      email_preferences.<type>_email = true, so we don't re-check that here.
 *      The user opts out of WhatsApp nudges by either unlinking WhatsApp
 *      ("whatsapp_linked = false") or running "shh" in chat
 *      (sets profiles.coaching_paused_until).
 *   3. Mirror — don't add. The message reproduces the most actionable line
 *      from the email so the user can act without opening their inbox.
 */

import { sendTextMessage } from './whatsapp';
import { getAdminSupabase } from './cron-helpers';
import type { TaskSummary, GoalSummary, DaySummary } from './email-templates';
import { personaGreeting, resolvePersona } from './persona-tone';
import type { BotPersona } from '@/types';

// ── Eligibility ────────────────────────────────────────────────────────

interface NudgeRecipient {
  phone: string;
}

type SkipReason = 'not_linked' | 'no_phone' | 'paused' | 'no_profile' | 'query_error';

interface ResolveResult {
  recipient: NudgeRecipient | null;
  skipReason?: SkipReason;
}

/**
 * Resolve the WhatsApp recipient for a user, or return null if they shouldn't
 * receive a nudge right now (not linked, no phone on file, or coaching paused).
 *
 * Coaching pause comes from the in-chat "shh" command — see
 * src/app/api/whatsapp/webhook/route.ts handlePauseCoaching.
 *
 * Returns the skipReason alongside null so the caller can produce per-reason
 * counters in cron logs. That's what makes "WhatsApp reports aren't working"
 * diagnosable from server logs alone — without the breakdown, every skip
 * looks the same.
 */
async function resolveRecipient(userId: string): Promise<ResolveResult> {
  try {
    const supabase = getAdminSupabase();
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('phone_number, whatsapp_linked, coaching_paused_until')
      .eq('id', userId)
      .maybeSingle();

    if (error || !profile) return { recipient: null, skipReason: error ? 'query_error' : 'no_profile' };
    if (!profile.whatsapp_linked) return { recipient: null, skipReason: 'not_linked' };
    if (!profile.phone_number) return { recipient: null, skipReason: 'no_phone' };

    if (profile.coaching_paused_until) {
      const pausedUntil = new Date(profile.coaching_paused_until).getTime();
      if (pausedUntil > Date.now()) return { recipient: null, skipReason: 'paused' };
    }

    return { recipient: { phone: profile.phone_number } };
  } catch (err) {
    console.error('[whatsapp-nudge] resolveRecipient failed', { userId, err });
    return { recipient: null, skipReason: 'query_error' };
  }
}

// ── Coach log (audit) ──────────────────────────────────────────────────

async function logNudge(opts: {
  userId: string;
  nudgeType: 'morning_email_companion' | 'afternoon_email_companion' | 'nightly_email_companion';
  message: string;
  delivered: boolean;
}) {
  try {
    const supabase = getAdminSupabase();
    await supabase.from('coach_log').insert({
      user_id: opts.userId,
      nudge_type: opts.nudgeType,
      message_sent: opts.message,
      delivered: opts.delivered,
      context_json: { source: 'cron_email_companion' },
    });
  } catch (err) {
    // Audit failure is non-fatal — we already sent the message.
    console.error('[whatsapp-nudge] logNudge failed', err);
  }
}

// ── Message builders ───────────────────────────────────────────────────
//
// Each builder takes the same data the corresponding email already has and
// produces a short (3-line max) WhatsApp body. We use WA bold (*x*) and italic
// (_x_) sparingly — the WhatsApp client renders them inline on phones.

function firstName(name: string): string {
  return name.split(' ')[0] || 'there';
}

// Persona-aware opening lines. Each persona has its own voice for
// "good morning" / "midday check" / "wrap up", consistent with the
// AI coach prompts in coach-ai.ts. Unrecognised persona values fall
// through resolvePersona() to 'friend'.
function morningHeader(persona: BotPersona, fn: string, dayOfWeek: string): string {
  const greet = personaGreeting(persona, fn);
  switch (persona) {
    case 'boss':      return `${greet} — ${dayOfWeek} stand-up.`;
    case 'mentor':    return `${greet}. Hope ${dayOfWeek} starts well.`;
    case 'colleague': return `${greet} — fresh ${dayOfWeek}, fresh queue.`;
    case 'friend':    return `☀️ *Good morning, ${fn}* — happy ${dayOfWeek}.`;
  }
}

function afternoonHeader(persona: BotPersona, fn: string): string {
  switch (persona) {
    case 'boss':      return `${personaGreeting(persona, fn)} — midday check-in. 📈`;
    case 'mentor':    return `${personaGreeting(persona, fn)} — checking in mid-afternoon.`;
    case 'colleague': return `${personaGreeting(persona, fn)} — quick midday peek at the queue.`;
    case 'friend':    return `👋 Mid-day check, ${fn}.`;
  }
}

function nightlyHeader(persona: BotPersona, fn: string): string {
  switch (persona) {
    case 'boss':      return `*${fn}*, day-end report. ✅`;
    case 'mentor':    return `${personaGreeting(persona, fn)} — winding down.`;
    case 'colleague': return `${personaGreeting(persona, fn)} — closing the queue for the day.`;
    case 'friend':    return `🌙 *That's a wrap, ${fn}.*`;
  }
}

function morningPrompt(persona: BotPersona): string {
  switch (persona) {
    case 'boss':      return `Top 3 deliverables for today? Reply to commit them.`;
    case 'mentor':    return `What three things would make today feel like a win? Reply to log them.`;
    case 'colleague': return `What's on the queue today? Reply to add it.`;
    case 'friend':    return `What are today's 3 priorities? Reply to add tasks.`;
  }
}

function afternoonPrompt(persona: BotPersona): string {
  switch (persona) {
    case 'boss':      return `Reply *"plan"* to pull today's deliverables.`;
    case 'mentor':    return `Reply *"what's my plan?"* if you want to revisit today's list.`;
    case 'colleague': return `Reply *"what's my plan?"* and I'll show the queue.`;
    case 'friend':    return `Reply *"what's my plan?"* to see today's list.`;
  }
}

function nightlyPrompt(persona: BotPersona, tomorrowDay: string): string {
  switch (persona) {
    case 'boss':      return `Log a retro line, or reply *"plan tomorrow"* to scope ${tomorrowDay}.`;
    case 'mentor':    return `What's one thing today taught you? Reply to journal, or *"plan tomorrow"* for ${tomorrowDay}.`;
    case 'colleague': return `Reply with a journal line, or *"plan tomorrow"* to queue up ${tomorrowDay}.`;
    case 'friend':    return `How did today go? Reply to log a journal entry, or *"plan tomorrow"* to set up ${tomorrowDay}.`;
  }
}

export function morningWhatsAppMessage(opts: {
  userName: string;
  yesterdayTasks: TaskSummary[];
  activeGoal?: GoalSummary;
  dayOfWeek: string;
  persona?: BotPersona | string | null;
}): string {
  const { userName, yesterdayTasks, activeGoal, dayOfWeek } = opts;
  const persona = resolvePersona(opts.persona);
  const fn = firstName(userName);
  const completedYesterday = yesterdayTasks.filter(t => t.completed).length;
  const carriedForward = yesterdayTasks.filter(t => !t.completed).length;

  const lines: string[] = [morningHeader(persona, fn, dayOfWeek)];

  if (yesterdayTasks.length > 0) {
    lines.push(
      `Yesterday: ${completedYesterday}/${yesterdayTasks.length} tasks done` +
      (carriedForward > 0 ? ` · ${carriedForward} still open` : ''),
    );
  }

  if (activeGoal) {
    lines.push(
      `🎯 ${activeGoal.title}: ${activeGoal.sessions_completed}/${activeGoal.estimated_sessions} sessions` +
      (activeGoal.streak > 0 ? ` · 🔥 ${activeGoal.streak} day streak` : ''),
    );
  }

  lines.push(morningPrompt(persona));
  return lines.join('\n');
}

export function afternoonWhatsAppMessage(opts: {
  userName: string;
  todayTasks: TaskSummary[];
  sessionsToday: number;
  focusMinutesToday: number;
  persona?: BotPersona | string | null;
}): string {
  const { userName, todayTasks, sessionsToday, focusMinutesToday } = opts;
  const persona = resolvePersona(opts.persona);
  const fn = firstName(userName);
  const done = todayTasks.filter(t => t.completed).length;
  const total = todayTasks.length;
  const hours = Math.floor(focusMinutesToday / 60);
  const mins = focusMinutesToday % 60;
  const focusStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const lines: string[] = [afternoonHeader(persona, fn)];

  if (sessionsToday > 0) {
    // Lead with tasks done, since that&apos;s the unit the user actually
    // tracks against their day. Pomodoros + focused time are how-the-
    // work-happened metrics — they belong second. The previous order
    // (sessions first) made completed tasks easy to overlook, which
    // landed as the user-reported "I did 5 tasks today but the bot
    // doesn&apos;t reflect it" bug.
    lines.push(
      `📊 ${done}/${total} task${total === 1 ? '' : 's'} done · ${sessionsToday} session${sessionsToday === 1 ? '' : 's'} · ${focusStr} focused`,
    );
  } else {
    lines.push(
      total > 0
        ? `Still 0 sessions today. ${total - done} task${(total - done) === 1 ? '' : 's'} waiting — pick one and start a pom?`
        : `Quiet day so far. Reply with a task and I'll add it.`,
    );
  }

  lines.push(afternoonPrompt(persona));
  return lines.join('\n');
}

export function nightlyWhatsAppMessage(opts: {
  userName: string;
  todayTasks: TaskSummary[];
  daySummary: DaySummary;
  activeGoal?: GoalSummary;
  tomorrowDay: string;
  /**
   * Open errands on the side list ("Other To-Dos"). Surfaced ONLY in the
   * nightly recap as a quiet count line — never in morning/afternoon nudges.
   * That's a deliberate product choice: errands are a parking lot, not a
   * daily-grind item, so we don't push them. Default 0 = omit the line.
   */
  openOtherTodosCount?: number;
  /**
   * Whether the user has yet to journal today. When true the message
   * promotes journaling to the primary CTA — a one-shot proactive prompt
   * even for users who don't have Beast Mode enabled. Defaults to false
   * (keeps the legacy "how did today go?" wording).
   */
  journalMissing?: boolean;
  /**
   * Whether tomorrow's daily_tasks list is empty. When true the message
   * promotes "plan tomorrow" to the primary CTA. Combined with
   * journalMissing this becomes a punchy two-line ask.
   */
  tomorrowPlanMissing?: boolean;
  persona?: BotPersona | string | null;
}): string {
  const { userName, todayTasks, daySummary, activeGoal, tomorrowDay, openOtherTodosCount = 0,
    journalMissing = false, tomorrowPlanMissing = false } = opts;
  const persona = resolvePersona(opts.persona);
  const fn = firstName(userName);
  const done = todayTasks.filter(t => t.completed).length;
  const total = todayTasks.length;
  const hours = Math.floor(daySummary.total_focus_minutes / 60);
  const mins = daySummary.total_focus_minutes % 60;
  const focusStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const lines: string[] = [nightlyHeader(persona, fn)];
  lines.push(
    `Today: ${done}/${total} tasks · ${daySummary.total_sessions} session${daySummary.total_sessions === 1 ? '' : 's'} · ${focusStr} focused` +
    (daySummary.streak > 0 ? ` · 🔥 ${daySummary.streak} day streak` : ''),
  );

  if (activeGoal) {
    const remaining = Math.max(0, activeGoal.estimated_sessions - activeGoal.sessions_completed);
    lines.push(`🎯 ${activeGoal.title} — ${remaining} sessions to go.`);
  }

  if (openOtherTodosCount > 0) {
    lines.push(
      `📋 Plus ${openOtherTodosCount} errand${openOtherTodosCount === 1 ? '' : 's'} on your side list.`,
    );
  }

  // Proactive prompts — only fire when the corresponding gap is real.
  // We choose targeted copy over a generic "what's next" because users
  // act on specific asks ("write one line about today") far more than
  // open-ended ones. Beast Mode escalates these on a 30-min cadence;
  // here we get one nightly shot regardless of tier.
  if (journalMissing && tomorrowPlanMissing) {
    lines.push(
      `📝 No journal yet, and tomorrow's list is empty. Reply with one line about today, then *"plan tomorrow"* to set up ${tomorrowDay}.`,
    );
  } else if (journalMissing) {
    lines.push(
      `📝 No journal yet for today. Reply with one line + a mood (great/good/meh/rough/hard) and I'll log it.`,
    );
  } else if (tomorrowPlanMissing) {
    lines.push(
      `🗓️ Tomorrow (${tomorrowDay}) is empty. Reply *"plan tomorrow"* and I'll help you queue 1–3 things.`,
    );
  } else {
    lines.push(nightlyPrompt(persona, tomorrowDay));
  }
  return lines.join('\n');
}

// ── Public entry point ─────────────────────────────────────────────────

export type NudgeType = 'morning' | 'afternoon' | 'nightly';

const NUDGE_TYPE_TO_LOG: Record<NudgeType, 'morning_email_companion' | 'afternoon_email_companion' | 'nightly_email_companion'> = {
  morning: 'morning_email_companion',
  afternoon: 'afternoon_email_companion',
  nightly: 'nightly_email_companion',
};

export type NudgeOutcome =
  | { kind: 'sent' }
  | { kind: 'skipped'; reason: SkipReason }
  | { kind: 'send_failed' };

/**
 * Send a WhatsApp nudge that mirrors the email we just sent. Returns a
 * structured outcome so the caller can break down failures by reason —
 * "X users not linked, Y paused, Z send-failed". The previous boolean
 * return collapsed all of those into a single counter, which made
 * "WhatsApp reports aren't arriving" un-diagnosable from logs.
 *
 * Caller should NOT treat anything other than `sent` as fatal — the
 * email already went out and WhatsApp is best-effort.
 */
export async function sendCronNudge(opts: {
  userId: string;
  nudgeType: NudgeType;
  message: string;
}): Promise<NudgeOutcome> {
  const { userId, nudgeType, message } = opts;

  const { recipient, skipReason } = await resolveRecipient(userId);
  if (!recipient) {
    return { kind: 'skipped', reason: skipReason ?? 'no_profile' };
  }

  try {
    const ok = await sendTextMessage(recipient.phone, message);
    await logNudge({
      userId,
      nudgeType: NUDGE_TYPE_TO_LOG[nudgeType],
      message,
      delivered: ok,
    });
    return ok ? { kind: 'sent' } : { kind: 'send_failed' };
  } catch (err) {
    console.error('[whatsapp-nudge] send failed', { userId, nudgeType, err });
    await logNudge({
      userId,
      nudgeType: NUDGE_TYPE_TO_LOG[nudgeType],
      message,
      delivered: false,
    });
    return { kind: 'send_failed' };
  }
}
