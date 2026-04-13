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

/** Plan ID — create this once in your Razorpay dashboard or via the setup script */
export const PLAN_ID = process.env.RAZORPAY_PLAN_ID || '';

/** Trial duration in days */
export const TRIAL_DAYS = 3;

/** Monthly price in smallest currency unit (paise for INR, cents for USD) */
export const MONTHLY_PRICE = Number(process.env.RAZORPAY_MONTHLY_PRICE || 49900); // default ₹499 = 49900 paise

/** Currency */
export const CURRENCY = process.env.RAZORPAY_CURRENCY || 'INR';

