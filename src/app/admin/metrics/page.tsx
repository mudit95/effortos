import { requireAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

// Assumed price in INR per active subscription for MRR. Adjust as needed.
const PRICE_INR = 499;

export default async function AdminMetricsPage() {
  const check = await requireAdmin();
  if (!check.ok) return null;
  const { supabase } = check;

  const now = new Date();
  const start24h = new Date(now.getTime() - 24 * 3600 * 1000);
  const start7d = new Date(now.getTime() - 7 * 86400000);
  const start30d = new Date(now.getTime() - 30 * 86400000);

  const [
    { count: totalUsers },
    { count: signups24h },
    { count: signups7d },
    { count: signups30d },
    { count: trialing },
    { count: active },
    { count: expired },
    { count: cancelled },
    { data: dauRows },
  ] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', start24h.toISOString()),
    supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', start7d.toISOString()),
    supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', start30d.toISOString()),
    supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'trialing'),
    supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'expired'),
    supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'cancelled'),
    supabase
      .from('sessions')
      .select('user_id, created_at')
      .gte('created_at', start24h.toISOString())
      .limit(5000),
  ]);

  const dau = new Set((dauRows ?? []).map((r: { user_id: string }) => r.user_id)).size;
  const trialToPaidConversion = (trialing ?? 0) + (active ?? 0) > 0
    ? Math.round(((active ?? 0) / ((trialing ?? 0) + (active ?? 0))) * 100)
    : 0;
  const mrr = (active ?? 0) * PRICE_INR;

  const cards = [
    { label: 'Total users', value: totalUsers ?? 0 },
    { label: 'Signups (24h)', value: signups24h ?? 0 },
    { label: 'Signups (7d)', value: signups7d ?? 0 },
    { label: 'Signups (30d)', value: signups30d ?? 0 },
    { label: 'DAU (sessions last 24h)', value: dau },
    { label: 'Trialing', value: trialing ?? 0 },
    { label: 'Paid (active)', value: active ?? 0 },
    { label: 'Expired', value: expired ?? 0 },
    { label: 'Cancelled', value: cancelled ?? 0 },
    { label: 'Trial → Paid %', value: `${trialToPaidConversion}%` },
    { label: 'MRR estimate', value: `₹${mrr.toLocaleString('en-IN')}` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Metrics</h2>
        <p className="text-sm text-white/50 mt-1">
          Signups, DAU (users who ran at least one session in last 24h), conversion, and MRR.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <p className="text-[10px] text-white/40 uppercase tracking-wider">{c.label}</p>
            <p className="mt-2 text-2xl font-semibold">{c.value}</p>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-white/30">
        MRR uses a flat ₹{PRICE_INR} / active subscription. Update PRICE_INR in <code>src/app/admin/metrics/page.tsx</code> if your pricing differs.
      </p>
    </div>
  );
}
