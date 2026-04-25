import Razorpay from 'razorpay';

let _instance: Razorpay | null = null;

/** Lazily creates a Razorpay instance — avoids crashing at build time when env vars are missing */
export function getRazorpay(): Razorpay {
  if (!_instance) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw new Error('Razorpay credentials not configured');
    }

    _instance = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return _instance;
}

/** Starter plan ID — create in Razorpay dashboard (₹499/month) */
export const STARTER_PLAN_ID = process.env.RAZORPAY_PLAN_ID || '';

/** Pro plan ID — create in Razorpay dashboard (₹999/month) */
export const PRO_PLAN_ID = process.env.RAZORPAY_PRO_PLAN_ID || '';

/** Annual plan IDs — create in Razorpay dashboard (₹4,999/year, ₹9,999/year) */
export const STARTER_ANNUAL_PLAN_ID = process.env.RAZORPAY_STARTER_ANNUAL_PLAN_ID || '';
export const PRO_ANNUAL_PLAN_ID = process.env.RAZORPAY_PRO_ANNUAL_PLAN_ID || '';

/** Legacy alias */
export const PLAN_ID = STARTER_PLAN_ID;

/** Trial duration in days */
export const TRIAL_DAYS = 3;

/** Monthly prices in smallest currency unit (paise for INR) */
export const STARTER_MONTHLY_PRICE = Number(process.env.RAZORPAY_MONTHLY_PRICE || 49900);   // ₹499
export const PRO_MONTHLY_PRICE = Number(process.env.RAZORPAY_PRO_MONTHLY_PRICE || 99900);    // ₹999

/** Annual prices in paise. ~17% discount vs. monthly × 12. */
export const STARTER_ANNUAL_PRICE = Number(process.env.RAZORPAY_STARTER_ANNUAL_PRICE || 499900); // ₹4,999
export const PRO_ANNUAL_PRICE = Number(process.env.RAZORPAY_PRO_ANNUAL_PRICE || 999900);         // ₹9,999

/** Legacy alias */
export const MONTHLY_PRICE = STARTER_MONTHLY_PRICE;

/** Currency */
export const CURRENCY = process.env.RAZORPAY_CURRENCY || 'INR';

/** Billing cycle for plan selection. */
export type BillingCycle = 'monthly' | 'annual';

/** Get the correct plan ID for a tier + billing cycle. */
export function getPlanIdForTier(
  tier: 'starter' | 'pro',
  cycle: BillingCycle = 'monthly',
): string {
  if (cycle === 'annual') {
    return tier === 'pro' ? PRO_ANNUAL_PLAN_ID : STARTER_ANNUAL_PLAN_ID;
  }
  return tier === 'pro' ? PRO_PLAN_ID : STARTER_PLAN_ID;
}

/** Set of all plan amounts the webhook should accept. */
export const ALL_PLAN_AMOUNTS_PAISE: ReadonlySet<number> = new Set([
  STARTER_MONTHLY_PRICE,
  PRO_MONTHLY_PRICE,
  STARTER_ANNUAL_PRICE,
  PRO_ANNUAL_PRICE,
]);
