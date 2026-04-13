'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Copy, Power } from 'lucide-react';

interface Coupon {
  id: string;
  code: string;
  kind: 'percent_off' | 'trial_extension' | 'free_months';
  discount_value: number;
  description: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  expires_at: string | null;
  active: boolean;
  created_at: string;
  razorpay_offer_id?: string | null;
}

const KIND_LABEL: Record<Coupon['kind'], string> = {
  percent_off: '% off',
  trial_extension: 'trial days',
  free_months: 'free months',
};

export function CouponsManager({ initial }: { initial: Coupon[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    code: '',
    kind: 'percent_off' as Coupon['kind'],
    discount_value: 10,
    description: '',
    max_redemptions: '',
    expires_at: '',
    razorpay_offer_id: '',
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/admin/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: form.code.trim().toUpperCase(),
          kind: form.kind,
          discount_value: Number(form.discount_value),
          description: form.description || null,
          max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
          expires_at: form.expires_at || null,
          razorpay_offer_id: form.kind === 'percent_off' ? (form.razorpay_offer_id.trim() || null) : null,
        }),
      });
      if (!res.ok) {
        alert(await res.text());
      } else {
        setShowForm(false);
        setForm({ code: '', kind: 'percent_off', discount_value: 10, description: '', max_redemptions: '', expires_at: '', razorpay_offer_id: '' });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, active: boolean) {
    const res = await fetch('/api/admin/coupons', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active: !active }),
    });
    if (!res.ok) alert(await res.text());
    else router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(v => !v)}
          className="px-3 py-1.5 text-xs rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/20 flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> New coupon
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="p-4 border border-white/[0.06] bg-white/[0.02] rounded-xl grid grid-cols-2 gap-3">
          <label className="col-span-1 text-xs text-white/50 flex flex-col gap-1">
            Code
            <input
              required
              value={form.code}
              onChange={e => setForm({ ...form, code: e.target.value })}
              placeholder="SUMMER25"
              className="px-2 py-1.5 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-white focus:outline-none focus:border-white/20"
            />
          </label>
          <label className="col-span-1 text-xs text-white/50 flex flex-col gap-1">
            Kind
            <select
              value={form.kind}
              onChange={e => setForm({ ...form, kind: e.target.value as Coupon['kind'] })}
              className="px-2 py-1.5 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-white focus:outline-none focus:border-white/20"
            >
              <option value="percent_off">Percent off</option>
              <option value="trial_extension">Trial extension (days)</option>
              <option value="free_months">Free premium months</option>
            </select>
          </label>
          <label className="col-span-1 text-xs text-white/50 flex flex-col gap-1">
            Value
            <input
              type="number"
              min={1}
              required
              value={form.discount_value}
              onChange={e => setForm({ ...form, discount_value: Number(e.target.value) })}
              className="px-2 py-1.5 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-white focus:outline-none focus:border-white/20"
            />
          </label>
          <label className="col-span-1 text-xs text-white/50 flex flex-col gap-1">
            Max redemptions (blank = unlimited)
            <input
              type="number"
              min={1}
              value={form.max_redemptions}
              onChange={e => setForm({ ...form, max_redemptions: e.target.value })}
              className="px-2 py-1.5 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-white focus:outline-none focus:border-white/20"
            />
          </label>
          <label className="col-span-2 text-xs text-white/50 flex flex-col gap-1">
            Description
            <input
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className="px-2 py-1.5 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-white focus:outline-none focus:border-white/20"
            />
          </label>
          {form.kind === 'percent_off' && (
            <label className="col-span-2 text-xs text-white/50 flex flex-col gap-1">
              Razorpay Offer ID (required for percent_off to actually discount checkout)
              <input
                value={form.razorpay_offer_id}
                onChange={e => setForm({ ...form, razorpay_offer_id: e.target.value })}
                placeholder="offer_PXXXXXXXXXXXXX"
                className="px-2 py-1.5 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-white focus:outline-none focus:border-white/20 font-mono"
              />
              <span className="text-[10px] text-white/30">
                Create an Offer in Razorpay dashboard first (Offers → New), then paste its ID here.
                Without this, the coupon will show the discount but payment won&apos;t be reduced.
              </span>
            </label>
          )}

          <label className="col-span-1 text-xs text-white/50 flex flex-col gap-1">
            Expires at (optional)
            <input
              type="datetime-local"
              value={form.expires_at}
              onChange={e => setForm({ ...form, expires_at: e.target.value })}
              className="px-2 py-1.5 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-white focus:outline-none focus:border-white/20"
            />
          </label>
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-3 py-1.5 text-xs text-white/60 hover:text-white">Cancel</button>
            <button
              disabled={busy}
              type="submit"
              className="px-3 py-1.5 text-xs rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create coupon'}
            </button>
          </div>
        </form>
      )}

      <div className="border border-white/[0.06] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-white/[0.02] text-left text-[10px] text-white/40 uppercase tracking-wider">
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Kind</th>
              <th className="px-4 py-3 font-medium">Value</th>
              <th className="px-4 py-3 font-medium">Redemptions</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {initial.map(c => (
              <tr key={c.id} className="border-t border-white/[0.04]">
                <td className="px-4 py-3 font-mono text-white">
                  {c.code}
                  {c.kind === 'percent_off' && !c.razorpay_offer_id && (
                    <span className="ml-2 text-[9px] text-yellow-400" title="No Razorpay Offer ID — discount won't apply at checkout">⚠</span>
                  )}
                </td>
                <td className="px-4 py-3 text-white/60">{KIND_LABEL[c.kind]}</td>
                <td className="px-4 py-3 text-white">{c.discount_value}</td>
                <td className="px-4 py-3 text-white/60">
                  {c.redemption_count}{c.max_redemptions ? ` / ${c.max_redemptions}` : ''}
                </td>
                <td className="px-4 py-3 text-white/60">
                  {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${c.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-white/50'}`}>
                    {c.active ? 'active' : 'disabled'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex gap-1">
                    <button
                      onClick={() => navigator.clipboard.writeText(c.code)}
                      className="px-2 py-1 text-xs rounded border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04]"
                    >
                      <Copy className="w-3 h-3 inline" /> Copy
                    </button>
                    <button
                      onClick={() => toggle(c.id, c.active)}
                      className="px-2 py-1 text-xs rounded border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04]"
                    >
                      <Power className="w-3 h-3 inline" /> {c.active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {initial.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-white/40">No coupons yet. Create one to get started.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
