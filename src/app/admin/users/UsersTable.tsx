'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, Shield } from 'lucide-react';

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

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusPill(status?: string | null) {
  const map: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-300',
    trialing: 'bg-cyan-500/15 text-cyan-300',
    expired: 'bg-red-500/15 text-red-300',
    cancelled: 'bg-yellow-500/15 text-yellow-300',
  };
  const cls = status ? map[status] ?? 'bg-white/10 text-white/70' : 'bg-white/10 text-white/50';
  return <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${cls}`}>{status ?? 'none'}</span>;
}

export function UsersTable({ rows }: { rows: UserRow[] }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();

  const filtered = rows.filter(r => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (r.email ?? '').toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q);
  });

  async function call(path: string, body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        alert(`Error: ${t}`);
      } else {
        router.refresh();
      }
    } catch (e) {
      alert('Request failed: ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function extendTrial(userId: string) {
    const daysStr = window.prompt('Extend trial by how many days?', '7');
    const days = Number(daysStr);
    if (!days || Number.isNaN(days)) return;
    await call('/api/admin/users/extend-trial', { userId, days }, `extend-${userId}`);
  }

  async function grantPremium(userId: string) {
    const monthsStr = window.prompt('Grant how many months of premium?', '1');
    const months = Number(monthsStr);
    if (!months || Number.isNaN(months)) return;
    await call('/api/admin/users/grant-premium', { userId, months }, `grant-${userId}`);
  }

  async function toggleAdmin(userId: string, current: boolean) {
    if (!confirm(current ? 'Revoke admin from this user?' : 'Promote this user to admin?')) return;
    await call('/api/admin/users/set-admin', { userId, isAdmin: !current }, `admin-${userId}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-white/30 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by email or name…"
            className="w-full pl-9 pr-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
          />
        </div>
        <p className="text-xs text-white/40 ml-auto">{filtered.length} of {rows.length}</p>
      </div>

      <div className="border border-white/[0.06] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-white/[0.02] text-left text-[10px] text-white/40 uppercase tracking-wider">
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Trial ends</th>
              <th className="px-4 py-3 font-medium">Period ends</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div>
                      <p className="text-white">{u.name || '—'}</p>
                      <p className="text-xs text-white/40">{u.email}</p>
                    </div>
                    {u.is_admin && <Shield className="w-3.5 h-3.5 text-cyan-400" />}
                  </div>
                </td>
                <td className="px-4 py-3">{statusPill(u.status)}</td>
                <td className="px-4 py-3 text-white/60">{formatDate(u.trial_ends_at)}</td>
                <td className="px-4 py-3 text-white/60">{formatDate(u.current_period_end)}</td>
                <td className="px-4 py-3 text-white/60">{formatDate(u.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex gap-1">
                    <button
                      disabled={busy === `extend-${u.id}`}
                      onClick={() => extendTrial(u.id)}
                      className="px-2 py-1 text-xs rounded border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04] disabled:opacity-50"
                    >
                      + Trial
                    </button>
                    <button
                      disabled={busy === `grant-${u.id}`}
                      onClick={() => grantPremium(u.id)}
                      className="px-2 py-1 text-xs rounded border border-cyan-500/20 text-cyan-300 hover:border-cyan-400/40 hover:bg-cyan-500/10 disabled:opacity-50"
                    >
                      <Plus className="w-3 h-3 inline" /> Premium
                    </button>
                    <button
                      disabled={busy === `admin-${u.id}`}
                      onClick={() => toggleAdmin(u.id, u.is_admin)}
                      className={`px-2 py-1 text-xs rounded border disabled:opacity-50 ${
                        u.is_admin
                          ? 'border-yellow-500/20 text-yellow-300 hover:border-yellow-400/40 hover:bg-yellow-500/10'
                          : 'border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04]'
                      }`}
                    >
                      {u.is_admin ? 'Revoke admin' : 'Make admin'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-white/40">No users match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
