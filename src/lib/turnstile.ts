/**
 * Cloudflare Turnstile + honeypot bot protection.
 *
 * Two layers:
 *
 *   1. HONEYPOT: an invisible form field that real browsers leave blank
 *      and bots usually fill. Free, no external dependency, catches the
 *      lazy 80% of automated signups.
 *
 *   2. TURNSTILE: Cloudflare's CAPTCHA-replacement (no user puzzle in
 *      most cases — invisible challenge). Catches the smarter 20%.
 *      Requires TURNSTILE_SITE_KEY (public, baked into client) +
 *      TURNSTILE_SECRET_KEY (server-only) env vars.
 *
 * Setup:
 *   - dash.cloudflare.com → Turnstile → Add site
 *   - Choose "Managed" widget, Pre-clearance: off
 *   - Allowed domains: your effortos.com (+ vercel.app preview if needed)
 *   - Copy site key → NEXT_PUBLIC_TURNSTILE_SITE_KEY in Vercel
 *   - Copy secret key → TURNSTILE_SECRET_KEY in Vercel
 *
 * Without env vars, Turnstile silently no-ops (honeypot still works).
 * Letting honeypot-only mode work in dev means we don't have to
 * configure Turnstile to test the rest of the signup flow.
 */

export interface BotCheckInput {
  /** The honeypot field value submitted with the form. */
  honeypot?: string | null;
  /** The Turnstile cf-turnstile-response token. Optional — may be empty. */
  turnstileToken?: string | null;
  /** Caller's IP for Turnstile verification. Best-effort from x-forwarded-for. */
  remoteIp?: string | null;
}

export interface BotCheckResult {
  ok: boolean;
  reason?: 'honeypot_filled' | 'turnstile_failed' | 'turnstile_unconfigured';
}

/**
 * Verify a signup-style submission against bot-detection signals.
 *
 * Order:
 *   1. If the honeypot field has any non-empty value, reject — only bots
 *      fill hidden inputs.
 *   2. If TURNSTILE_SECRET_KEY is set, verify the token with Cloudflare.
 *      Reject on any non-success response.
 *   3. Else accept (honeypot-only mode).
 */
export async function verifyHumanish(input: BotCheckInput): Promise<BotCheckResult> {
  if (input.honeypot && input.honeypot.trim().length > 0) {
    return { ok: false, reason: 'honeypot_filled' };
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Honeypot-only mode. Fine for dev, accepted in prod when Turnstile
    // isn't configured yet — but log so launch-day operator notices.
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[turnstile] TURNSTILE_SECRET_KEY not set — running in honeypot-only mode. Bots will get through.',
      );
    }
    return { ok: true };
  }

  if (!input.turnstileToken) {
    return { ok: false, reason: 'turnstile_failed' };
  }

  try {
    const form = new URLSearchParams();
    form.append('secret', secret);
    form.append('response', input.turnstileToken);
    if (input.remoteIp) form.append('remoteip', input.remoteIp);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) {
      console.error('[turnstile] verify endpoint returned', res.status);
      return { ok: false, reason: 'turnstile_failed' };
    }
    const json = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (!json.success) {
      console.error('[turnstile] verification failed:', json['error-codes']);
      return { ok: false, reason: 'turnstile_failed' };
    }
    return { ok: true };
  } catch (err) {
    console.error('[turnstile] fetch threw:', err);
    return { ok: false, reason: 'turnstile_failed' };
  }
}
