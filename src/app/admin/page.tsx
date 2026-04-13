import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';
import { Users, Ticket, BarChart3, FileText } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const check = await requireAdmin();
  if (!check.ok) return null;
  const { supabase } = check;

  // Quick counts
  const [
    { count: userCount },
    { count: activeCoupons },
    { count: trialUsers },
    { count: paidUsers },
  ] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('coupons').select('*', { count: 'exact', head: true }).eq('active', true),
    supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'trialing'),
    supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
  ]);

  const stats = [
    { label: 'Total users', value: userCount ?? 0 },
    { label: 'Trialing', value: trialUsers ?? 0 },
    { label: 'Paid', value: paidUsers ?? 0 },
    { label: 'Active coupons', value: activeCoupons ?? 0 },
  ];

  const cards = [
    { href: '/admin/users', label: 'Users', desc: 'Extend trials, grant premium, view activity.', icon: Users },
    { href: '/admin/coupons', label: 'Coupons', desc: 'Create, disable, and inspect redemptions.', icon: Ticket },
    { href: '/admin/metrics', label: 'Metrics', desc: 'Signups, DAU, MRR, conversion.', icon: BarChart3 },
    { href: '/admin/content', label: 'Content', desc: 'Edit landing copy, paywall text and more.', icon: FileText },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold">Admin overview</h2>
        <p className="text-sm text-white/50 mt-1">Quick glance at system health and tools.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <p className="text-xs text-white/40 uppercase tracking-wider">{s.label}</p>
            <p className="mt-2 text-2xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map(c => {
          const Icon = c.icon;
          return (
            <Link
              key={c.href}
              href={c.href}
              className="p-5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h3 className="font-semibold">{c.label}</h3>
                  <p className="text-xs text-white/50">{c.desc}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
