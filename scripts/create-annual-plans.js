#!/usr/bin/env node
/**
 * Creates the EffortOS Starter Annual (₹3,999/year) and Pro Annual
 * (₹7,999/year) plans on Razorpay.
 *
 * Mirrors scripts/create-pro-plan.js but creates two annual-period plans
 * in a single run so the env-var setup stays atomic — partial creation
 * (one of two) leaves the app in a state where the UI shows annual
 * but checkout breaks for one tier.
 *
 * Usage:
 *   RAZORPAY_KEY_ID=rzp_xxx RAZORPAY_KEY_SECRET=yyy node scripts/create-annual-plans.js
 *
 * Or with .env.local:
 *   npx dotenv -e .env.local -- node scripts/create-annual-plans.js
 *
 * After running, copy the printed plan IDs into the Vercel environment:
 *   RAZORPAY_STARTER_ANNUAL_PLAN_ID=plan_xxx
 *   RAZORPAY_PRO_ANNUAL_PLAN_ID=plan_yyy
 *
 * Idempotency: Razorpay's plans API is NOT idempotent — re-running this
 * creates duplicate plans. Run once per environment (test mode and live
 * mode are separate). If you re-run by accident, archive the duplicate
 * via the Razorpay dashboard.
 */

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!KEY_ID || !KEY_SECRET) {
  console.error('❌ Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET env vars first.');
  process.exit(1);
}

/**
 * Creates a single annual plan and returns the resulting plan_id.
 * @param {{ tier: 'starter' | 'pro', amountPaise: number, displayName: string, description: string }} spec
 */
async function createAnnualPlan(spec) {
  const res = await fetch('https://api.razorpay.com/v1/plans', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64'),
    },
    body: JSON.stringify({
      // Razorpay's `period` enum accepts 'yearly' for annual plans (NOT
      // 'annual' — that's a 400). Verified against the Plans API doc.
      period: 'yearly',
      interval: 1,
      item: {
        name: spec.displayName,
        amount: spec.amountPaise,
        currency: 'INR',
        description: spec.description,
      },
      notes: {
        tier: spec.tier,
        cadence: 'annual',
        created_by: 'create-annual-plans.js',
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`❌ Failed to create ${spec.tier} annual plan:`, JSON.stringify(data, null, 2));
    process.exit(1);
  }

  return data;
}

async function run() {
  console.log('Creating Starter Annual plan…');
  const starter = await createAnnualPlan({
    tier: 'starter',
    amountPaise: 399900, // ₹3,999
    displayName: 'EffortOS Starter (Annual)',
    description: 'EffortOS Starter — Pomodoro + AI estimation + WhatsApp bot, ₹3,999/year (4 months free vs. monthly).',
  });

  console.log('Creating Pro Annual plan…');
  const pro = await createAnnualPlan({
    tier: 'pro',
    amountPaise: 799900, // ₹7,999
    displayName: 'EffortOS Pro (Annual)',
    description: 'EffortOS Pro — Proactive AI Coach on WhatsApp, ₹7,999/year (4 months free vs. monthly).',
  });

  console.log('\n✅ Annual plans created successfully!\n');
  console.log('   Starter Annual ID:', starter.id, ' (₹' + (starter.item.amount / 100) + '/yr)');
  console.log('   Pro Annual ID:    ', pro.id, ' (₹' + (pro.item.amount / 100) + '/yr)');
  console.log('\n📋 Add these to your Vercel env vars:\n');
  console.log(`   RAZORPAY_STARTER_ANNUAL_PLAN_ID=${starter.id}`);
  console.log(`   RAZORPAY_PRO_ANNUAL_PLAN_ID=${pro.id}`);
  console.log('\n   Then redeploy: npx vercel --prod');
  console.log('\n⚠️  Re-running this script creates DUPLICATE plans — archive via dashboard if needed.');
}

run().catch((err) => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
