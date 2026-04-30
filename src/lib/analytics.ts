/**
 * Lightweight analytics shim.
 *
 * The contract:
 *   - Server-side and client-side both expose `track(event, distinctId, props)`.
 *   - When NEXT_PUBLIC_POSTHOG_KEY is unset (the default at launch), every
 *     call is a no-op. Setting the key in Vercel turns analytics on without
 *     redeploying — events start firing on the next request.
 *   - We post directly to PostHog's HTTP capture endpoint, which keeps the
 *     dependency surface zero (no posthog-node, no posthog-js bundle weight
 *     until you actually want it).
 *
 * Why ship the wiring before the key:
 *   When the launch funnel breaks, you don't want to be instrumenting the
 *   app — you want to be staring at a chart. Wiring the events into the
 *   right call sites NOW means launch day is "paste the key and reload."
 *
 * What's tracked:
 *   signup_started        — server signup endpoint accepted bot check
 *   signup_completed      — auth.users row created
 *   first_pomodoro_started — store.startTimer for a user with 0 prior sessions
 *   first_pomodoro_completed — completeTimerSession for that user
 *   paywall_shown         — PaywallModal opened
 *   subscription_started  — Razorpay verify accepted
 *   subscription_charged  — Razorpay webhook received first 'charged' event
 *   re_engagement_clicked — user clicked link from re-engagement email
 *
 * Naming convention: lower_snake_case verbs in past tense (`signup_completed`,
 * not `Signup` or `signupCompleted`). Matches PostHog's defaults and stays
 * sortable in their funnels UI.
 */

const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ||
  'https://app.posthog.com';

interface TrackInput {
  /** Stable per-user id. Use auth.users.id for signed-in users; for
   *  pre-signup events use the anon cookie (effortos_anon) the consent
   *  banner sets. */
  distinctId: string;
  /** Event name in lower_snake_case. */
  event: string;
  /** Optional event properties. PostHog auto-sets $current_url, $referrer,
   *  $browser etc. when called from the browser. */
  properties?: Record<string, unknown>;
}

/**
 * Fire-and-forget event capture. Resolves immediately with `void` —
 * analytics outages never block the user-facing request.
 */
export async function track(input: TrackInput): Promise<void> {
  // Either build environment can call this; the public key gates both.
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return; // No-op when not configured.

  const body = {
    api_key: apiKey,
    event: input.event,
    distinct_id: input.distinctId,
    properties: input.properties ?? {},
    timestamp: new Date().toISOString(),
  };

  try {
    // Don't await long. PostHog's capture is intentionally fast (<150ms p95)
    // but a single hung request shouldn't extend an API route's response.
    // We fire the fetch but use Promise.race so we cap the wait at 1.5s.
    const fetchPromise = fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // keepalive lets browser-side calls continue after the page unloads —
      // important for "user closed tab right after clicking" funnel events.
      keepalive: typeof window !== 'undefined',
    });
    await Promise.race([
      fetchPromise,
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch (err) {
    // Analytics outages are never user-visible. Log loudly so launch-day
    // operator notices via Sentry or console.
    console.warn('[analytics] track failed (non-fatal):', input.event, err);
  }
}

/**
 * Convenience: read or mint the anonymous browser id used for pre-signup
 * events. Matches the cookie set by the ConsentBanner so funnels stitch
 * correctly when a visitor eventually signs up.
 */
export function getAnonymousId(): string {
  if (typeof document === 'undefined') return 'server';
  const m = document.cookie.match(/(?:^|;\s*)effortos_anon=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  const fresh =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  document.cookie = `effortos_anon=${encodeURIComponent(fresh)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  return fresh;
}
