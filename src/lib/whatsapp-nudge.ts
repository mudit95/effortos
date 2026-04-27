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

// ── Eligibility ────────────────────────────────────────────────────────

interface NudgeRecipient {
  phone: string;
}

/**
 * Resolve the WhatsApp recipient for a user, or return null if they shouldn't
 * receive a nudge right now (not linked, no phone on file, or coaching paused).
 *
 * Coaching pause comes from the in-chat "shh" command — see
 * src/app/api/whatsapp/webhook/route.ts handlePauseCoaching.
 */
async function resolveRecipient(userId: string): Promise<NudgeRecipient | null> {
  try {
    const supabase = getAdminSupabase();
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('phone_number, whatsapp_linked, coaching_paused_until')
      .eq('id', userId)
      .maybeSingle();

    if (error || !profile) return null;
    if (!profile.whatsapp_linked) return null;
    if (!profile.phone_number) return null;

    if (profile.coaching_paused_until) {
      const pausedUntil = new Date(profile.coaching_paused_until).getTime();
      if (pausedUntil > Date.now()) return null;
    }

    return { phone: profile.phone_number };
  } catch (err) {
    console.error('[whatsapp-nudge] resolveRecipient failed', { userId, err });
    return null;
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

export function morningWhatsAppMessage(opts: {
  userName: string;
  yesterdayTasks: TaskSummary[];
  activeGoal?: GoalSummary;
  dayOfWeek: string;
}): string {
  const { userName, yesterdayTasks, activeGoal, dayOfWeek } = opts;
  const fn = firstName(userName);
  const completedYesterday = yesterdayTasks.filter(t => t.completed).length;
  const carriedForward = yesterdayTasks.filter(t => !t.completed).length;

  const lines: string[] = [`☀️ *Good morning, ${fn}* — happy ${dayOfWeek}.`];

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

  lines.push(`What are today's 3 priorities? Reply to add tasks.`);
  return lines.join('\n');
}

export function afternoonWhatsAppMessage(opts: {
  userName: string;
  todayTasks: TaskSummary[];
  sessionsToday: number;
  focusMinutesToday: number;
}): string {
  const { userName, todayTasks, sessionsToday, focusMinutesToday } = opts;
  const fn = firstName(userName);
  const done = todayTasks.filter(t => t.completed).length;
  const total = todayTasks.length;
  const hours = Math.floor(focusMinutesToday / 60);
  const mins = focusMinutesToday % 60;
  const focusStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const lines: string[] = [`👋 Mid-day check, ${fn}.`];

  if (sessionsToday > 0) {
    lines.push(
      `📊 ${sessionsToday} session${sessionsToday === 1 ? '' : 's'} · ${focusStr} focused · ${done}/${total} task${total === 1 ? '' : 's'} done`,
    );
  } else {
    lines.push(
      total > 0
        ? `Still 0 sessions today. ${total - done} task${(total - done) === 1 ? '' : 's'} waiting — pick one and start a pom?`
        : `Quiet day so far. Reply with a task and I'll add it.`,
    );
  }

  lines.push(`Reply *"what's my plan?"* to see today's list.`);
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
}): string {
  const { userName, todayTasks, daySummary, activeGoal, tomorrowDay, openOtherTodosCount = 0 } = opts;
  const fn = firstName(userName);
  const done = todayTasks.filter(t => t.completed).length;
  const total = todayTasks.length;
  const hours = Math.floor(daySummary.total_focus_minutes / 60);
  const mins = daySummary.total_focus_minutes % 60;
  const focusStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const lines: string[] = [`🌙 *That's a wrap, ${fn}.*`];
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

  lines.push(
    `How did today go? Reply to log a journal entry, or *"plan tomorrow"* to set up ${tomorrowDay}.`,
  );
  return lines.join('\n');
}

// ── Public entry point ─────────────────────────────────────────────────

export type NudgeType = 'morning' | 'afternoon' | 'nightly';

const NUDGE_TYPE_TO_LOG: Record<NudgeType, 'morning_email_companion' | 'afternoon_email_companion' | 'nightly_email_companion'> = {
  morning: 'morning_email_companion',
  afternoon: 'afternoon_email_companion',
  nightly: 'nightly_email_companion',
};

/**
 * Send a WhatsApp nudge that mirrors the email we just sent. Returns true
 * if a message was actually delivered, false if skipped or failed (caller
 * should NOT treat false as fatal — the email already went out).
 */
export async function sendCronNudge(opts: {
  userId: string;
  nudgeType: NudgeType;
  message: string;
}): Promise<boolean> {
  const { userId, nudgeType, message } = opts;

  const recipient = await resolveRecipient(userId);
  if (!recipient) return false;

  try {
    const ok = await sendTextMessage(recipient.phone, message);
    await logNudge({
      userId,
      nudgeType: NUDGE_TYPE_TO_LOG[nudgeType],
      message,
      delivered: ok,
    });
    return ok;
  } catch (err) {
    console.error('[whatsapp-nudge] send failed', { userId, nudgeType, err });
    await logNudge({
      userId,
      nudgeType: NUDGE_TYPE_TO_LOG[nudgeType],
      message,
      delivered: false,
    });
    return false;
  }
}
