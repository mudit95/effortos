/**
 * Shared constants and helpers for the accountability-pacts feature.
 *
 * The list view (/api/pacts GET) and the cleanup cron
 * (/api/cron/pacts-cleanup) both need to agree on what "stale" means
 * for a pending pact — the UI hides them once they cross this
 * threshold, the cron flips them to 'declined' on the same threshold.
 * Keeping the value in one place prevents the two from drifting.
 */

/** Days before a pending pact invite is considered expired. */
export const PENDING_PACT_TTL_DAYS = 7;
