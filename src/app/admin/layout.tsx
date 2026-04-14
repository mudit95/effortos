import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin';
import { LayoutDashboard, Users, Ticket, BarChart3, FileText, Mail, LogOut } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const check = await requireAdmin();
  if (!check.ok) {
    if (check.reason === 'unauthenticated') redirect('/login?redirect=/admin');
    redirect('/dashboard');
  }

  const nav = [
    { href: '/admin', label: 'Overview', icon: LayoutDashboard },
    { href: '/admin/users', label: 'Users', icon: Users },
    { href: '/admin/coupons', label: 'Coupons', icon: Ticket },
    { href: '/admin/metrics', label: 'Metrics', icon: BarChart3 },
    { href: '/admin/content', label: 'Content', icon: FileText },
    { href: '/admin/email', label: 'Email', icon: Mail },
  ];

  return (
    <div className="min-h-screen bg-[#0B0F14] text-white flex">
      <aside className="w-60 border-r border-white/[0.06] bg-white/[0.02] flex flex-col">
        <div className="px-5 py-5 border-b border-white/[0.06]">
          <p className="text-[10px] text-white/30 uppercase tracking-widest">EffortOS</p>
          <h1 className="text-sm font-semibold text-white">Admin</h1>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {nav.map(item => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-white/70 hover:text-white hover:bg-white/[0.04] transition-colors"
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-2 border-t border-white/[0.06]">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Back to app
          </Link>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
