/**
 * GET /api/referral/code
 *
 * Returns the caller's personal referral coupon code, creating it on
 * first call. Idempotent: re-calling returns the same code.
 *
 * Response shape:
 *   {
 *     code: string,                  // human-friendly, e.g. EFFORTOS-MUDIT-A8K2
 *     url: string,                   // /?ref=<code> share link
 *     redemption_count: number,      // friends who've redeemed so far
 *     max_redemptions: number,       // cap (10 by default)
 *     reward: {
 *       redeemer_months: number,     // what the friend gets (1 month)
 *       referrer_months: number,     // what the user gets per redemption (1 month)
 *     }
 *   }
 *
 * Anti-abuse:
 *   - Auth required.
 *   - Rate-limit (light bucket).
 *   - Cap = 10 friends per code per user. Resets only by admin action.
 *   - Self-redemption blocked at /api/coupons/redeem.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { rateLimitOrNull } from '@/lib/ratelimit';

const REDEEMER_MONTHS = 1;
const REFERRER_KICKBACK_MONTHS = 1;
const MAX_REDEMPTIONS_PER_CODE = 10;

/**
 * Build a memorable, conflict-resistant code from the user's name +
 * a short random suffix. Examples:
 *   EFFORTOS-MUDIT-A8K2
 *   EFFORTOS-FRIEND-3XQR
 *
 * The suffix is 4 chars from a dictionary that excludes 0/O/1/I/L
 * to dodge transcription mistakes when users speak the code out loud.
 */
function makeReferralCode(name: string | null | undefined): string {
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // base32 minus ambiguous chars
  const suffix = Array.from({ length: 4 }, () =>
    ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length)),
  ).join('');
  const safeName = (name ?? 'FRIEND')
    .split(/\s+/)[0]
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8) || 'FRIEND';
  return `EFFORTOS-${safeName}-${suffix}`;
}

function getOrigin(req: Request): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit && explicit.startsWith('http')) return explicit.replace(/\/$/, '');
  try {
    return new URL(req.url).origin;
  } catch {
    return 'https://effortos-zeta.vercel.app';
  }
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const blocked = await rateLimitOrNull(user.id, 'light');
  if (blocked) return blocked;

  const service = createServiceClient();

  // Existing referral code for this user?
  const { data: existing } = await service
    .from('coupons')
    .select('code, redemption_count, max_redemptions, discount_value, referrer_kickback_months')
    .eq('referrer_user_id', user.id)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const origin = getOrigin(req);
    return NextResponse.json({
      code: existing.code,
      url: `${origin}/?ref=${encodeURIComponent(existing.code as string)}`,
      redemption_count: existing.redemption_count ?? 0,
      max_redemptions: existing.max_redemptions ?? MAX_REDEMPTIONS_PER_CODE,
      reward: {
        redeemer_months: Number(existing.discount_value) || REDEEMER_MONTHS,
        referrer_months: Number(existing.referrer_kickback_months) || REFERRER_KICKBACK_MONTHS,
      },
    });
  }

  // Mint a new one. Get the user's display name for the code prefix.
  const { data: profile } = await service
    .from('profiles')
    .select('name')
    .eq('id', user.id)
    .maybeSingle();

  // Insert with collision-retry. The UNIQUE constraint on coupons.code
  // means a (rare) random suffix collision needs to retry with a new
  // suffix; 4 chars × 31 alphabet ≈ 1M codes so one or two retries is
  // a generous ceiling.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = makeReferralCode(profile?.name as string | null | undefined);
    const { data: inserted, error } = await service
      .from('coupons')
      .insert({
        code,
        kind: 'free_months',
        discount_value: REDEEMER_MONTHS,
        description: 'Referral — friend signup',
        max_redemptions: MAX_REDEMPTIONS_PER_CODE,
        active: true,
        referrer_user_id: user.id,
        referrer_kickback_months: REFERRER_KICKBACK_MONTHS,
      })
      .select('code, redemption_count, max_redemptions')
      .single();

    if (!error && inserted) {
      const origin = getOrigin(req);
      return NextResponse.json({
        code: inserted.code,
        url: `${origin}/?ref=${encodeURIComponent(inserted.code as string)}`,
        redemption_count: inserted.redemption_count ?? 0,
        max_redemptions: inserted.max_redemptions ?? MAX_REDEMPTIONS_PER_CODE,
        reward: {
          redeemer_months: REDEEMER_MONTHS,
          referrer_months: REFERRER_KICKBACK_MONTHS,
        },
      });
    }

    const errCode = (error as { code?: string } | null)?.code;
    if (errCode !== '23505') {
      console.error('[referral/code] insert failed:', error);
      return NextResponse.json({ error: 'Failed to create referral code' }, { status: 500 });
    }
    // 23505: code collision, retry with a new suffix
  }

  return NextResponse.json({ error: 'Could not generate referral code' }, { status: 500 });
}
