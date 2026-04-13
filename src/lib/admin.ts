import { createClient } from '@/lib/supabase/server';

/**
 * Server-side helper: confirm the current request user is an admin.
 * Throws-like return: returns { ok: false } when not admin.
 */
export async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, reason: 'unauthenticated', supabase, user: null };

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (!profile?.is_admin) {
    return { ok: false as const, reason: 'forbidden', supabase, user };
  }
  return { ok: true as const, supabase, user };
}
