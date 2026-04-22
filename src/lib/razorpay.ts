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

/** Legacy alias */
export const PLAN_ID = STARTER_PLAN_ID;

/** Trial duration in days */
export const TRIAL_DAYS = 3;

/** Monthly prices in smallest currency unit (paise for INR) */
export const STARTER_MONTHLY_PRICE = Number(process.env.RAZORPAY_MONTHLY_PRICE || 49900);   // ₹499
export const PRO_MONTHLY_PRICE = Number(process.env.RAZORPAY_PRO_MONTHLY_PRICE || 99900);    // ₹999

/** Legacy alias */
export const MONTHLY_PRICE = STARTER_MONTHLY_PRICE;

/** Currency */
export const CURRENCY = process.env.RAZORPAY_CURRENCY || 'INR';

/** Get the correct plan ID for a tier */
export function getPlanIdForTier(tier: 'starter' | 'pro'): string {
  return tier === 'pro' ? PRO_PLAN_ID : STARTER_PLAN_ID;
}
