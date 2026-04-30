import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

/**
 * Global security headers, applied to every route via Next's `headers()` hook.
 *
 * What's here and why:
 *
 *   - Strict-Transport-Security: tells browsers "always HTTPS" for two years
 *     (the preload-list minimum). includeSubDomains + preload makes us
 *     eligible to register on hstspreload.org once the apex domain is live.
 *
 *   - X-Frame-Options DENY: blocks iframe embedding outright. Combined with
 *     CSP frame-ancestors below for browsers that respect both.
 *
 *   - X-Content-Type-Options nosniff: stops browsers from re-interpreting
 *     a JSON response as HTML/JS, which is the foundation of stored-XSS in
 *     user-content endpoints.
 *
 *   - Referrer-Policy strict-origin-when-cross-origin: send origin only
 *     across cross-site navigations. Prevents leaking full URLs (?code=…
 *     OAuth tokens, ?t=… unsubscribe tokens) to third-party sites.
 *
 *   - Permissions-Policy: deny features we don't use (camera, microphone,
 *     geolocation, payment) so an XSS / supply-chain compromise can't
 *     silently flip them on.
 *
 *   - Content-Security-Policy: deliberately permissive for now (we use
 *     Razorpay's checkout iframe + Sentry tunnelled monitoring + inline
 *     framer-motion styles). Defines an allowlist instead of letting any
 *     domain serve scripts. Tighten further when each subprocessor's
 *     domains are pinned.
 *
 * Some of these duplicate what Vercel applies by default — duplicating
 * is safe; the more specific value (ours) wins.
 */
const SECURITY_HEADERS = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    // Deny what we don't use; allow self for the few that may matter
    // later (notifications, audio output for the timer chimes).
    value:
      'accelerometer=(), autoplay=(self), camera=(), display-capture=(), ' +
      'encrypted-media=(self), fullscreen=(self), geolocation=(), gyroscope=(), ' +
      'magnetometer=(), microphone=(), midi=(), payment=(self), picture-in-picture=(self), ' +
      'usb=(), interest-cohort=()',
  },
  {
    key: 'Content-Security-Policy',
    // Pragmatic CSP: covers our known third-party origins (Razorpay,
    // Supabase, Resend webhooks, Anthropic isn't browser-side, Groq isn't
    // browser-side). 'unsafe-inline' is required for framer-motion's
    // inlined style updates; tighten by moving to nonces in a future pass.
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co https://*.razorpay.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.razorpay.com https://lumberjack.razorpay.com https://*.sentry.io https://challenges.cloudflare.com https://app.posthog.com https://*.posthog.com",
      "media-src 'self' blob: https://*.supabase.co",
      "frame-src 'self' https://api.razorpay.com https://*.razorpay.com https://challenges.cloudflare.com",
      "frame-ancestors 'none'",
      "form-action 'self' https://api.razorpay.com",
      "base-uri 'self'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply to every route. Next merges with route-specific headers if
        // any; nothing in this app sets per-route security headers today.
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

/**
 * Wraps the Next.js config with Sentry's plugin. Uploads source maps during
 * production builds (when SENTRY_AUTH_TOKEN is set) and auto-injects the
 * client config. Harmless no-op if no DSN is configured.
 */
export default withSentryConfig(nextConfig, {
  // Sentry org/project — set from env so CI doesn't need to hardcode them.
  // These are safe to omit for local dev; Sentry's plugin just skips upload.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Quieter build output
  silent: !process.env.CI,

  // Route browser calls to /monitoring to avoid ad-blockers dropping Sentry
  // traffic. Safe default.
  tunnelRoute: '/monitoring',

  // Don't widen the client bundle with optional Sentry features we don't use.
  widenClientFileUpload: false,
  disableLogger: true,
});
