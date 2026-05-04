/**
 * Service-role helper for getting (or minting) a user's streak share
 * token. Used by milestone-celebration nudges and any future server-
 * side path that wants to enrich a message with a public share URL.
 *
 * Mirrors the logic in /api/share/streak's GET handler but refactored
 * to take a supabase client (so the proactive-coach cron can use
 * the service-role client it already has). Returns null on any
 * failure — calling code should fall back gracefully.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

const SHARE_KIND = 'streak' as const;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://effortos-zeta.vercel.app';

function makeToken(): string {
  // 40 hex chars: 16^40 ≈ 1.5e48 collision space.
  const a = crypto.randomUUID().replace(/-/g, '');
  const b = crypto.randomUUID().replace(/-/g, '');
  return (a + b).slice(0, 40);
}

/** Returns the absolute share URL for this user's active streak token,
 *  minting a new token if none exists. Null on any unrecoverable error. */
export async function getOrMintStreakShareUrl(
  supabase: Sb,
  userId: string,
): Promise<string | null> {
  try {
    // Look for existing active token first.
    const { data: existing } = await supabase
      .from('share_tokens')
      .select('token')
      .eq('user_id', userId)
      .eq('kind', SHARE_KIND)
      .is('revoked_at', null)
      .maybeSingle();

    if (existing?.token) {
      return `${APP_URL}/share/streak/${existing.token}`;
    }

    // Mint a new one — retry on the rare collision.
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = makeToken();
      const { error } = await supabase
        .from('share_tokens')
        .insert({ user_id: userId, token, kind: SHARE_KIND });
      if (!error) return `${APP_URL}/share/streak/${token}`;
      const code = (error as { code?: string }).code;
      if (code !== '23505') {
        console.error('[share-token-helper] insert failed:', error);
        return null;
      }
    }
    return null;
  } catch (e) {
    console.error('[share-token-helper] error:', e);
    return null;
  }
}
