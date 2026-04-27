/**
 * Persistent state for the WhatsApp webhook handler.
 *
 * Why this module exists: the webhook used to keep three things in
 * `Map<string, ...>` instances at module top-level:
 *
 *   - rateLimitMap     (per-user message counter)
 *   - pendingFlowMap   (multi-step "awaiting journal entry" state)
 *   - taskListMap      (numbered task reply memory)
 *
 * Module-scoped Maps are per-instance memory. On Vercel, each cold container
 * has its own copy, which means:
 *
 *   - Rate limits are 6× looser than advertised when there are 6 warm
 *     instances; users could trivially exceed them.
 *   - A "send your journal entry now" prompt stored on instance A is invisible
 *     to instance B, so the user's reply is treated as a fresh message.
 *   - Numbered task replies (`"1"` to complete the first task) lose their
 *     mapping the moment routing lands on a different instance.
 *
 * Solution: back all three with Upstash Redis, which is already used for the
 * coach rate limiter. Keys carry TTLs at the storage layer so we never have to
 * sweep expired entries by hand.
 *
 * Failure mode:
 *   - In production with Redis missing, calls fail soft: getters return null,
 *     setters no-op, rate limits are bypassed. The webhook keeps responding
 *     200 to Meta (anything else gets the integration disabled), and a console
 *     error fires once per process so the misconfig is visible.
 */

import { getRedis } from './ratelimit';
import { rateLimitCoach } from './ratelimit';

// TTLs match the in-memory values that came before — keep behaviour stable.
const PENDING_TTL_SEC = 10 * 60; // 10 minutes
const TASK_LIST_TTL_SEC = 30 * 60; // 30 minutes

let warned = false;
function warnOnce() {
  if (warned) return;
  warned = true;
  console.error(
    '[wa-state] UPSTASH_REDIS_REST_URL/TOKEN not set — WhatsApp webhook state is in-process only. ' +
      'Multi-step flows and rate limits will leak across instances.',
  );
}

export type PendingFlowType = 'journal' | 'reflection';
export interface PendingFlow {
  type: PendingFlowType;
  userId: string;
}

/** Key namespaces — short prefixes to keep Upstash storage compact. */
const k = {
  pending: (phone: string) => `wa:pending:${phone}`,
  taskList: (phone: string) => `wa:tasks:${phone}`,
  errandList: (phone: string) => `wa:errands:${phone}`,
  lastListType: (phone: string) => `wa:lastlist:${phone}`,
  msgCount: (phone: string) => `wa:msgcount:${phone}`,
};

// Effectively-permanent TTL for the outbound message counter. Re-set on
// every increment so it never expires while the user is active. One year
// is long enough that practically nobody sees it lapse.
const MSG_COUNT_TTL_SEC = 60 * 60 * 24 * 365;

// ── Pending multi-step flow ───────────────────────────────────────

/**
 * Mark this phone as awaiting a journal/reflection entry. Replaces any prior
 * pending flow for the same phone (last-write-wins).
 */
export async function setPendingFlow(phone: string, flow: PendingFlow): Promise<void> {
  const r = getRedis();
  if (!r) {
    warnOnce();
    return;
  }
  // Upstash auto-stringifies plain objects; we still serialize ourselves so
  // the parse on the way out is symmetric and predictable.
  await r.set(k.pending(phone), JSON.stringify(flow), { ex: PENDING_TTL_SEC });
}

/**
 * Atomically read and clear the pending flow for this phone. Uses GETDEL so
 * two near-simultaneous webhook deliveries can't both consume the same flow.
 * Returns null when none exists (the common case) or on parse failure.
 */
export async function consumePendingFlow(phone: string): Promise<PendingFlow | null> {
  const r = getRedis();
  if (!r) {
    warnOnce();
    return null;
  }
  // @upstash/redis exposes getdel as `getdel`; auto-deserialises JSON values.
  const val = await r.getdel<PendingFlow | string>(k.pending(phone));
  if (!val) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val) as PendingFlow;
  } catch {
    return null;
  }
}

// ── Numbered task list memory ─────────────────────────────────────

/**
 * Remember the ordered task IDs from the most recent `/tasks` reply we sent
 * to this phone. When the user replies "1", "2", etc., we look up which task
 * that maps to.
 */
export async function setTaskList(phone: string, taskIds: string[]): Promise<void> {
  const r = getRedis();
  if (!r) {
    warnOnce();
    return;
  }
  await r.set(k.taskList(phone), JSON.stringify(taskIds), { ex: TASK_LIST_TTL_SEC });
}

/** Read the cached task-id list without consuming it (the user might send
 *  another number reply within the TTL window). */
export async function getTaskList(phone: string): Promise<string[] | null> {
  const r = getRedis();
  if (!r) {
    warnOnce();
    return null;
  }
  const val = await r.get<string[] | string>(k.taskList(phone));
  if (!val) return null;
  if (Array.isArray(val)) return val;
  try {
    return JSON.parse(val) as string[];
  } catch {
    return null;
  }
}

/** Forget the cached task-id list. Called once a numbered reply has been
 *  matched and the action executed. */
export async function clearTaskList(phone: string): Promise<void> {
  const r = getRedis();
  if (!r) {
    warnOnce();
    return;
  }
  await r.del(k.taskList(phone));
}

// ── Numbered errand list memory (parallel to task list) ───────────
//
// When the user views their "Other To-Dos" list on WhatsApp, we cache
// the displayed errand IDs the same way we cache task IDs. A bare
// number reply ("3") looks up against whichever list was shown most
// recently — see lastListType below. Separate key so we never confuse
// task #3 with errand #3.

export type ListType = 'tasks' | 'errands';

export async function setErrandList(phone: string, errandIds: string[]): Promise<void> {
  const r = getRedis();
  if (!r) {
    warnOnce();
    return;
  }
  await r.set(k.errandList(phone), JSON.stringify(errandIds), { ex: TASK_LIST_TTL_SEC });
}

export async function getErrandList(phone: string): Promise<string[] | null> {
  const r = getRedis();
  if (!r) {
    warnOnce();
    return null;
  }
  const val = await r.get<string[] | string>(k.errandList(phone));
  if (!val) return null;
  if (Array.isArray(val)) return val;
  try {
    return JSON.parse(val) as string[];
  } catch {
    return null;
  }
}

/**
 * Remember which kind of list was most recently shown to this phone.
 * The numbered-reply handler reads this to decide whether "3" means
 * "task #3" or "errand #3". Same TTL as the list caches themselves.
 */
export async function setLastListType(phone: string, type: ListType): Promise<void> {
  const r = getRedis();
  if (!r) {
    warnOnce();
    return;
  }
  await r.set(k.lastListType(phone), type, { ex: TASK_LIST_TTL_SEC });
}

export async function getLastListType(phone: string): Promise<ListType | null> {
  const r = getRedis();
  if (!r) {
    warnOnce();
    return null;
  }
  const val = await r.get<string>(k.lastListType(phone));
  if (val === 'tasks' || val === 'errands') return val;
  return null;
}

// ── Outbound message counter (drives the "first-50" help hint) ──
//
// Every reply we send to the user increments this counter. The first 50
// outbound messages append a "Send 'help' for the full command list."
// footer; after 50, the hint drops away — the user is presumed to have
// internalised the command set by then.
//
// Counter is per-phone (not per-userId) so it works even before we've
// linked the phone to a profile (e.g., onboarding replies).

/**
 * Atomically increment the outbound message counter for a phone and return
 * the new value. Used by sendTextMessage to decide whether to append the
 * help-hint footer.
 *
 * Failure mode: when Redis is unavailable, returns Infinity so the caller
 * skips the footer. Better to silently omit a friendly hint than to risk
 * spamming it on every single message in degraded mode.
 */
export async function incrementMessageCountAndGet(phone: string): Promise<number> {
  const r = getRedis();
  if (!r) {
    warnOnce();
    return Infinity;
  }
  try {
    const newCount = await r.incr(k.msgCount(phone));
    // Refresh TTL on every increment so the counter never silently resets
    // and puts the user back into "first 50" mode mid-relationship.
    await r.expire(k.msgCount(phone), MSG_COUNT_TTL_SEC);
    return newCount;
  } catch (err) {
    console.error('[wa-state] msgCount incr failed:', err);
    return Infinity;
  }
}

// ── AI rate limit ────────────────────────────────────────────────

/**
 * Returns true if this user is allowed to send another AI-parsed WhatsApp
 * message right now, false if they've burned through their hourly budget.
 *
 * Backed by the same @upstash/ratelimit instance used elsewhere. The
 * `whatsapp` tier is independent of `light`/`heavy` so a chatty WhatsApp user
 * can't lock themselves out of dashboard AI features.
 *
 * Fail-mode mirrors the coach rate limiter: closed in production when Redis
 * is missing, open in dev so local testing without Upstash keys still works.
 */
export async function checkWhatsappRateLimit(userId: string): Promise<boolean> {
  const result = await rateLimitCoach(userId, 'whatsapp');
  return result.ok;
}
