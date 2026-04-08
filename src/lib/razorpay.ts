import Razorpay from 'razorpay';

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn('Razorpay credentials not configured — payment features disabled.');
}

export const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || '',
  key_secret: process.env.RAZORPAY_KEY_SECRET || '',
});

/** Plan ID — create this once in your Razorpay dashboard or via the setup script */
export const PLAN_ID = process.env.RAZORPAY_PLAN_ID || '';

/** Trial duration in days */
export const TRIAL_DAYS = 3;

/** Monthly price in smallest currency unit (paise for INR, cents for USD) */
export const MONTHLY_PRICE = 499; // ₹4.99 = 499 paise, or $4.99 = 499 cents

/** Currency */
export const CURRENCY = process.env.RAZORPAY_CURRENCY || 'USD';
