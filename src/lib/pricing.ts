/**
 * Client-safe pricing display constants for both tiers.
 * Razorpay server code lives in ./razorpay.ts — don't import it from the browser.
 */

// ── Starter tier (default) ──
export const STARTER_PRICE = process.env.NEXT_PUBLIC_STARTER_PRICE || '₹499';
export const STARTER_PRICE_PER_MONTH = `${STARTER_PRICE}/month`;
export const STARTER_PRICE_PER_MO = `${STARTER_PRICE}/mo`;

// ── Pro tier ──
export const PRO_PRICE = process.env.NEXT_PUBLIC_PRO_PRICE || '₹999';
export const PRO_PRICE_PER_MONTH = `${PRO_PRICE}/month`;
export const PRO_PRICE_PER_MO = `${PRO_PRICE}/mo`;

// Legacy aliases (so existing imports don't break)
export const DISPLAY_PRICE = STARTER_PRICE;
export const DISPLAY_PRICE_PER_MONTH = STARTER_PRICE_PER_MONTH;
export const DISPLAY_PRICE_PER_MO = STARTER_PRICE_PER_MO;

// Feature lists for the pricing cards
export const STARTER_FEATURES = [
  'AI goal estimation & recalibration',
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
