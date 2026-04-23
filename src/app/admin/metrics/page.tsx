import { requireAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

const STARTER_PRICE_INR = 499;
const PRO_PRICE_INR = 999;

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
    { data: activeSubs },
    { count: proUsers },
    { count: coachNudges24h },
    { count: coachNudgesTotal },
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
    // Fetch active subs with plan_tier for MRR calculation
    supabase
      .from('subscriptions')
      .select('plan_tier')
      .eq('status', 'active'),
    // Pro-tier users (active or trialing)
    supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('plan_tier', 'pro')
      .in('status', ['active', 'trialing']),
    // Coach nudges in last 24h
    supabase
      .from('coach_log')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', start24h.toISOString()),
    // Coach nudges total
    supabase
      .from('coach_log')
      .select('*', { count: 'exact', head: true }),
  ]);

  const dau = new Set((dauRows ?? []).map((r: { user_id: string }) => r.user_id)).size;
  const trialToPaidConversion = (trialing ?? 0) + (active ?? 0) > 0
    ? Math.round(((active ?? 0) / ((trialing ?? 0) + (active ?? 0))) * 100)
    : 0;

  // Tier-aware MRR
  const starterCount = (activeSubs ?? []).filter((s: { plan_tier: string }) => s.plan_tier !== 'pro').length;
  const proCount = (activeSubs ?? []).filter((s: { plan_tier: string }) => s.plan_tier === 'pro').length;
  const mrrStarter = starterCount * STARTER_PRICE_INR;
  const mrrPro = proCount * PRO_PRICE_INR;
  const mrrTotal = mrrStarter + mrrPro;

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
    { label: 'Trial \u2192 Paid %', value: `${trialToPaidConversion}%` },
    { label: 'Pro subscribers', value: proUsers ?? 0 },
    { label: 'MRR (Starter)', value: `\u20B9${mrrStarter.toLocaleString('en-IN')}` },
    { label: 'MRR (Pro)', value: `\u20B9${mrrPro.toLocaleString('en-IN')}` },
    { label: 'MRR (Total)', value: `\u20B9${mrrTotal.toLocaleString('en-IN')}` },
    { label: 'Coach nudges (24h)', value: coachNudges24h ?? 0 },
    { label: 'Coach nudges (total)', value: coachNudgesTotal ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Metrics</h2>
        <p className="text-sm text-white/50 mt-1">
          Signups, DAU, conversion, tier-split MRR, and AI coach stats.
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
        MRR: Starter = {starterCount} &times; &nbsp;\u20B9{STARTER_PRICE_INR} &nbsp;|&nbsp; Pro = {proCount} &times; &nbsp;\u20B9{PRO_PRICE_INR}
      </p>
    </div>
  );
}
