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
};

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
