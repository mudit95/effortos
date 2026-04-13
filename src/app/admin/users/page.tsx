import { requireAdmin } from '@/lib/admin';
import { UsersTable } from './UsersTable';

export const dynamic = 'force-dynamic';

interface UserRow {
  id: string;
  email: string | null;
  name: string | null;
  is_admin: boolean;
  created_at: string;
  status?: string | null;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
}

export default async function AdminUsersPage() {
  const check = await requireAdmin();
  if (!check.ok) return null;
  const { supabase } = check;

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, name, is_admin, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  const ids = (profiles ?? []).map(p => p.id);
  const { data: subs } = await supabase
    .from('subscriptions')
    .select('user_id, status, trial_ends_at, current_period_end')
    .in('user_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);

  const subMap = new Map<string, { status: string; trial_ends_at: string | null; current_period_end: string | null }>();
  (subs ?? []).forEach(s => subMap.set(s.user_id, s));

  const rows: UserRow[] = (profiles ?? []).map(p => {
    const s = subMap.get(p.id);
    return {
      ...p,
      status: s?.status ?? null,
      trial_ends_at: s?.trial_ends_at ?? null,
      current_period_end: s?.current_period_end ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Users</h2>
        <p className="text-sm text-white/50 mt-1">Extend trials, grant premium, promote admins.</p>
      </div>
      <UsersTable rows={rows} />
    </div>
  );
}
