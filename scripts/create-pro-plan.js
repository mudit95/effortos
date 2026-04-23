#!/usr/bin/env node
/**
 * Creates the EffortOS Pro plan (₹999/month) on Razorpay.
 *
 * Usage:
 *   RAZORPAY_KEY_ID=rzp_xxx RAZORPAY_KEY_SECRET=yyy node scripts/create-pro-plan.js
 *
 * Or if you have .env.local:
 *   npx dotenv -e .env.local -- node scripts/create-pro-plan.js
 *
 * After running, copy the plan_id from the output and set it as
 * RAZORPAY_PRO_PLAN_ID in your Vercel environment variables.
 */

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!KEY_ID || !KEY_SECRET) {
  console.error('❌ Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET env vars first.');
  process.exit(1);
}

async function createProPlan() {
  const res = await fetch('https://api.razorpay.com/v1/plans', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64'),
    },
    body: JSON.stringify({
      period: 'monthly',
      interval: 1,
      item: {
        name: 'EffortOS Pro',
        amount: 99900, // ₹999 in paise
        currency: 'INR',
        description: 'EffortOS Pro — Proactive AI Coach on WhatsApp, ₹999/month',
      },
      notes: {
        tier: 'pro',
        created_by: 'create-pro-plan.js',
      },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('❌ Razorpay API error:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('✅ Pro plan created successfully!\n');
  console.log('   Plan ID:', data.id);
  console.log('   Name:', data.item.name);
  console.log('   Amount: ₹' + (data.item.amount / 100));
  console.log('   Period:', data.period);
  console.log('\n📋 Next step: Add this to your Vercel env vars:\n');
  console.log(`   RAZORPAY_PRO_PLAN_ID=${data.id}`);
  console.log('\n   Then redeploy: npx vercel --prod');
}

createProPlan().catch((err) => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
