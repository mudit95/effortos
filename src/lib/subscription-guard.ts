import { createClient } from '@/lib/supabase/server';

/**
 * Grace window for `past_due` users. After Razorpay flips a subscription
 * to past_due (payment retry exhausted), we keep premium access alive
 * for this many days past `current_period_end` so the user has a chance
 * to update their card before being blocked. 7 days is the SaaS norm.
 */
export const PAST_DUE_GRACE_DAYS = 7;
const PAST_DUE_GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Server-side guard for premium routes (AI, reports, analytics, etc.).
 * Returns `{ ok: true, userId }` when the user has an active trial or paid sub.
 * Returns `{ ok: false, reason, status }` otherwise — caller should return
 * `NextResponse.json({ error: reason }, { status })`.
 *
 * Usage:
 *   const gate = await requireActiveSub();
 *   if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });
 */
export async function requireActiveSub(): Promise<
  | { ok: true; userId: string }
  | { ok: false; reason: string; status: number }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'unauthenticated', status: 401 };

  // Get most-recent subscription row (there should only be one post-migration 006)
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('status, trial_ends_at, current_period_end')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fallback: no row yet — give implicit 3-day trial from signup so brand-new
  // users can use premium features during the first 3 days even if the
  // subscription row hasn't been created yet.
  if (!sub) {
    const trialEnd = new Date(new Date(user.created_at).getTime() + 3 * 24 * 60 * 60 * 1000);
    if (new Date() < trialEnd) return { ok: true, userId: user.id };
    return { ok: false, reason: 'subscription_required', status: 402 };
  }

  const now = new Date();

  // Premium (future period end) takes precedence regardless of status string
  if (sub.current_period_end && new Date(sub.current_period_end) > now) {
    return { ok: true, userId: user.id };
  }

  // Trialing with a future end date → OK
  if (sub.status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at) > now) {
    return { ok: true, userId: user.id };
  }

  // past_due grace window: Razorpay is retrying a failed charge. Keep
  // premium alive for PAST_DUE_GRACE_DAYS past `current_period_end` so
  // the user can update their card. Without this, a single failed retry
  // hard-blocks the user the moment the period ends — too aggressive.
  if (sub.status === 'past_due' && sub.current_period_end) {
    const graceEnd = new Date(sub.current_period_end).getTime() + PAST_DUE_GRACE_MS;
    if (now.getTime() < graceEnd) return { ok: true, userId: user.id };
  }

  // Active without period end (edge case, e.g. first activation) → OK
  if (sub.status === 'active') {
    return { ok: true, userId: user.id };
  }

  // Everything else (expired, cancelled past period end, none) → blocked
  return { ok: false, reason: 'subscription_required', status: 402 };
}
