/**
 * Admin action audit logger.
 *
 * Every admin endpoint that mutates billing or access state should call
 * `logAdminAction` after the mutation succeeds. The log is append-only,
 * service-role-write, admin-read (see migration 026 for RLS).
 *
 * Canonical action_type strings (use ALL_CAPS_SNAKE_CASE):
 *   USER_TRIAL_EXTENDED       — extend-trial endpoint
 *   USER_PREMIUM_GRANTED      — grant-premium endpoint
 *   USER_ADMIN_TOGGLED        — set-admin endpoint
 *   COUPON_CREATED            — admin coupon create
 *   COUPON_TOGGLED_ACTIVE     — admin coupon enable/disable
 *   ADMIN_EMAIL_SENT          — admin custom-email send
 *
 * Add new strings to that list when you add new admin actions, then use
 * the AdminActionType union below so the compiler enforces it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type AdminActionType =
  | 'USER_TRIAL_EXTENDED'
  | 'USER_PREMIUM_GRANTED'
  | 'USER_ADMIN_TOGGLED'
  | 'COUPON_CREATED'
  | 'COUPON_TOGGLED_ACTIVE'
  | 'ADMIN_EMAIL_SENT';

export interface LogAdminActionInput {
  /** Service-role Supabase client. Caller must NOT use the auth-bound one. */
  service: SupabaseClient;
  /** auth.uid() of the admin performing the action. */
  actorUserId: string;
  actionType: AdminActionType;
  /** When the action targets a single user, their auth.users.id. */
  targetUserId?: string | null;
  /** Free-form details: days extended, plan_tier granted, etc. */
  payload?: Record<string, unknown>;
  /** Original Request — used to pull IP + UA headers for forensics. */
  request?: Request;
}

/**
 * Insert a row into admin_actions. Errors are swallowed (we don't want
 * an audit-write failure to roll back the admin action that just succeeded
 * — but the failure is loudly logged so on-call sees it).
 */
export async function logAdminAction(input: LogAdminActionInput): Promise<void> {
  const { service, actorUserId, actionType, targetUserId, payload, request } = input;

  let request_ip: string | null = null;
  let user_agent: string | null = null;
  if (request) {
    // Vercel sets x-forwarded-for; first IP in the comma-separated list
    // is the original client. Trim and slice at 64 chars to stay sane.
    const xff = request.headers.get('x-forwarded-for');
    if (xff) request_ip = xff.split(',')[0].trim().slice(0, 64);
    user_agent = request.headers.get('user-agent')?.slice(0, 256) ?? null;
  }

  const { error } = await service.from('admin_actions').insert({
    actor_user_id: actorUserId,
    action_type: actionType,
    target_user_id: targetUserId ?? null,
    payload: payload ?? null,
    request_ip,
    user_agent,
  });

  if (error) {
    console.error('[adminAudit] insert failed (non-fatal):', error);
  }
}
