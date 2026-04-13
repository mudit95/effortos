import { requireAdmin } from '@/lib/admin';
import { CouponsManager } from './CouponsManager';

export const dynamic = 'force-dynamic';

export default async function AdminCouponsPage() {
  const check = await requireAdmin();
  if (!check.ok) return null;

  const { data: coupons } = await check.supabase
    .from('coupons')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Coupons</h2>
        <p className="text-sm text-white/50 mt-1">Create discount codes, trial extensions, or free premium grants.</p>
      </div>
      <CouponsManager initial={coupons ?? []} />
    </div>
  );
}
