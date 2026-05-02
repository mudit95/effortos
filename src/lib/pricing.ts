/**
 * Client-safe pricing display constants for both tiers.
 * Razorpay server code lives in ./razorpay.ts — don't import it from the browser.
 *
 * The env vars (NEXT_PUBLIC_*_PRICE) on Vercel are stored as bare numbers
 * (e.g., "999"), not formatted strings — both ways are valid env content
 * and we shouldn't trust the prod env to include the ₹. `withRupee` below
 * normalises whatever's in the env into a properly-prefixed ₹-string so
 * downstream displays never lose the currency symbol. Production showed
 * "Active subscription — 999/month" before this normalisation; that's a
 * chargeback risk on a Pro user's settings view.
 */

/**
 * Strip any leading currency symbol from `raw` and re-prefix with ₹.
 * Idempotent — calling on an already-prefixed value returns it
 * unchanged (modulo whitespace).
 */
function withRupee(raw: string): string {
  const cleaned = raw.trim().replace(/^[₹$€£¥Rs.\s]+/i, '');
  return `₹${cleaned}`;
}

// ── Starter tier (default) ──
export const STARTER_PRICE = withRupee(process.env.NEXT_PUBLIC_STARTER_PRICE || '499');
export const STARTER_PRICE_PER_MONTH = `${STARTER_PRICE}/month`;
export const STARTER_PRICE_PER_MO = `${STARTER_PRICE}/mo`;
export const STARTER_ANNUAL_PRICE = withRupee(
  process.env.NEXT_PUBLIC_STARTER_ANNUAL_PRICE || '3,999',
);
export const STARTER_ANNUAL_PRICE_PER_YEAR = `${STARTER_ANNUAL_PRICE}/year`;
/** Effective monthly rate for the annual plan, for "₹X/mo billed annually" copy. */
export const STARTER_ANNUAL_EFFECTIVE_MONTHLY = withRupee(
  process.env.NEXT_PUBLIC_STARTER_ANNUAL_EFFECTIVE_MONTHLY || '333',
);

// ── Pro tier ──
export const PRO_PRICE = withRupee(process.env.NEXT_PUBLIC_PRO_PRICE || '999');
export const PRO_PRICE_PER_MONTH = `${PRO_PRICE}/month`;
export const PRO_PRICE_PER_MO = `${PRO_PRICE}/mo`;
export const PRO_ANNUAL_PRICE = withRupee(
  process.env.NEXT_PUBLIC_PRO_ANNUAL_PRICE || '7,999',
);
export const PRO_ANNUAL_PRICE_PER_YEAR = `${PRO_ANNUAL_PRICE}/year`;
/** Effective monthly rate for Pro annual. */
export const PRO_ANNUAL_EFFECTIVE_MONTHLY = withRupee(
  process.env.NEXT_PUBLIC_PRO_ANNUAL_EFFECTIVE_MONTHLY || '667',
);

/** Annual plan savings copy — derived from the prices above (4 months free). */
export const STARTER_ANNUAL_SAVINGS = 'Save 33%';
export const PRO_ANNUAL_SAVINGS = 'Save 33%';
/** Headline savings rupee amount for marketing copy. */
export const STARTER_ANNUAL_SAVINGS_AMOUNT = '₹1,989/yr';  // 499*12 - 3999
export const PRO_ANNUAL_SAVINGS_AMOUNT = '₹3,989/yr';       // 999*12 - 7999

/** Billing cycle type used by pricing UI / paywall. */
export type BillingCycle = 'monthly' | 'annual';

// Legacy aliases (so existing imports don't break)
export const DISPLAY_PRICE = STARTER_PRICE;
export const DISPLAY_PRICE_PER_MONTH = STARTER_PRICE_PER_MONTH;
export const DISPLAY_PRICE_PER_MO = STARTER_PRICE_PER_MO;

// Feature lists for the pricing cards
export const STARTER_FEATURES = [
  'Smart goal estimation & recalibration',
  'Pomodoro focus timer',
  'Daily task management',
  'Streak tracking & reports',
  'WhatsApp bot (reactive)',
  'Email coaching digests',
  'Journal & mood tracking',
] as const;

export const PRO_FEATURES = [
  'Everything in Starter, plus:',
  'Proactive AI coach on WhatsApp',
  'Morning kickoff & evening wrap-up',
  'Streak saver alerts',
  'Smart idle & pace detection',
  'Weekly AI-generated recap',
  '"Plan tomorrow" via WhatsApp',
  'Coaching intensity controls',
] as const;
