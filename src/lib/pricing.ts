/**
 * Client-safe pricing display constants.
 * Razorpay server code lives in ./razorpay.ts — don't import it from the browser.
 */

/** Pre-formatted monthly display price shown in the UI. */
export const DISPLAY_PRICE = process.env.NEXT_PUBLIC_DISPLAY_PRICE || '₹499';

/** "₹499/month" */
export const DISPLAY_PRICE_PER_MONTH = `${DISPLAY_PRICE}/month`;

/** "₹499/mo" (shorter) */
export const DISPLAY_PRICE_PER_MO = `${DISPLAY_PRICE}/mo`;
