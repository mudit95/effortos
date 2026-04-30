/**
 * Sentry PII scrubber — shared across browser / server / edge runtimes so a
 * single change here updates every transport.
 *
 * What we strip:
 *   - Request bodies: contain user task titles, journal text, OAuth codes,
 *     Razorpay signatures, etc. None of this should land in error events.
 *   - Authorization / cookie headers: bearer tokens, session cookies.
 *   - Email addresses anywhere in the event JSON: redacted to "<email>".
 *   - Long strings (>400 chars): truncated. Helps when an Anthropic prompt
 *     accidentally lands in a breadcrumb.
 *
 * What we keep:
 *   - Stack traces, error messages (post-redaction), breadcrumb structure,
 *     URL pathname (NOT query string — that may carry tokens), HTTP method,
 *     status code, route name, runtime tags.
 *
 * sendDefaultPii: false in init() already prevents auto-attached PII (IP,
 * default headers). This module handles application-level data — the stuff
 * we put into the event ourselves via `extra`, `contexts`, or accidentally
 * via response/request capture.
 */

import type { ErrorEvent, Breadcrumb } from '@sentry/nextjs';

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const REDACTED_EMAIL = '<email>';
const MAX_STRING = 400;

/** Scrub a single value, handling strings/arrays/objects recursively. */
function scrub(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > 8) return '<deep>'; // defensive cycle guard
  if (typeof value === 'string') {
    let s = value.replace(EMAIL_RE, REDACTED_EMAIL);
    if (s.length > MAX_STRING) s = s.slice(0, MAX_STRING) + '…';
    return s;
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrub(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Drop sensitive header / cookie / token keys outright. Case-insensitive
      // match because some runtimes lowercase header names while others don't.
      const lower = k.toLowerCase();
      if (
        lower === 'authorization' ||
        lower === 'cookie' ||
        lower === 'set-cookie' ||
        lower === 'x-hub-signature-256' ||
        lower === 'x-razorpay-signature' ||
        lower.includes('apikey') ||
        lower.includes('api_key') ||
        lower.includes('token') ||
        lower.includes('secret') ||
        lower.includes('password')
      ) {
        out[k] = '<redacted>';
        continue;
      }
      out[k] = scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * beforeSend handler: pass to Sentry.init({ beforeSend: scrubEvent }).
 * Mutates and returns the event (Sentry expects null to drop, anything
 * else to keep).
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  // Drop request bodies entirely. They're never useful for triage and
  // routinely contain user-typed task titles, journal text, OAuth codes,
  // Razorpay payment payloads — all sensitive.
  if (event.request) {
    if ('data' in event.request) delete event.request.data;
    // Strip query strings too — they may carry tokens (?code=, ?t=).
    if (event.request.url) {
      try {
        const u = new URL(event.request.url);
        event.request.url = `${u.origin}${u.pathname}`;
      } catch {
        // not a parseable URL — leave as-is rather than dropping the field
      }
    }
    if (event.request.headers) {
      event.request.headers = scrub(event.request.headers) as Record<string, string>;
    }
    if (event.request.cookies) {
      delete event.request.cookies;
    }
  }

  // Walk extra/contexts/tags/breadcrumbs and scrub strings.
  if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrub(event.contexts) as ErrorEvent['contexts'];
  if (event.tags) event.tags = scrub(event.tags) as ErrorEvent['tags'];
  if (event.user) {
    // Keep user.id (useful for triage), drop everything else.
    event.user = { id: event.user.id };
  }
  if (event.message && typeof event.message === 'string') {
    event.message = scrub(event.message) as string;
  }
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((ex) => ({
      ...ex,
      value: typeof ex.value === 'string' ? (scrub(ex.value) as string) : ex.value,
    }));
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => scrubBreadcrumb(b)).filter(Boolean) as Breadcrumb[];
  }
  return event;
}

/** beforeBreadcrumb handler: pass to Sentry.init({ beforeBreadcrumb: scrubBreadcrumb }). */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  // Drop console.* breadcrumbs that look like they contain a JWT — these
  // are the most common accidental token leaks via console.log.
  if (typeof crumb.message === 'string' && /eyJ[\w-]{8,}/.test(crumb.message)) {
    return null;
  }
  return {
    ...crumb,
    message: typeof crumb.message === 'string' ? (scrub(crumb.message) as string) : crumb.message,
    data: crumb.data ? (scrub(crumb.data) as Record<string, unknown>) : crumb.data,
  };
}
