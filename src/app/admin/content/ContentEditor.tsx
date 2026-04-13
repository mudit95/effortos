'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save, Trash2 } from 'lucide-react';

interface ContentItem {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

export function ContentEditor({ initial }: { initial: ContentItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState<ContentItem[]>(initial);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDesc, setNewDesc] = useState('');

  function update(key: string, value: string) {
    setItems(items.map(it => it.key === key ? { ...it, value } : it));
    const next = new Set(dirty);
    next.add(key);
    setDirty(next);
  }

  async function save(key: string) {
    const item = items.find(i => i.key === key);
    if (!item) return;
    setBusy(key);
    try {
      const res = await fetch('/api/admin/content', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: item.key, value: item.value, description: item.description }),
      });
      if (!res.ok) { alert(await res.text()); return; }
      const next = new Set(dirty); next.delete(key); setDirty(next);
    } finally {
      setBusy(null);
    }
  }

  async function remove(key: string) {
    if (!confirm(`Delete content key "${key}"?`)) return;
    setBusy(key);
    try {
      const res = await fetch('/api/admin/content', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) { alert(await res.text()); return; }
      setItems(items.filter(i => i.key !== key));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!newKey.trim()) return;
    setBusy('__new');
    try {
      const res = await fetch('/api/admin/content', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newKey.trim(), value: newValue, description: newDesc || null }),
      });
      if (!res.ok) { alert(await res.text()); return; }
      setItems([...items, { key: newKey.trim(), value: newValue, description: newDesc || null, updated_at: new Date().toISOString() }]);
      setNewKey(''); setNewValue(''); setNewDesc('');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {items.map(item => (
          <div key={item.key} className="p-4 border border-white/[0.06] bg-white/[0.02] rounded-xl space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <code className="text-xs font-mono text-cyan-300">{item.key}</code>
              {item.description && <span className="text-xs text-white/40">{item.description}</span>}
            </div>
            <textarea
              value={item.value}
              onChange={e => update(item.key, e.target.value)}
              rows={Math.min(8, Math.max(2, Math.ceil(item.value.length / 80)))}
              className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-md text-sm text-white focus:outline-none focus:border-white/20 font-sans resize-y"
            />
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-white/30">Updated {new Date(item.updated_at).toLocaleString()}</p>
              <div className="flex gap-1">
                <button
                  onClick={() => remove(item.key)}
                  disabled={busy === item.key}
                  className="px-2 py-1 text-xs rounded border border-red-500/20 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3 inline" /> Delete
                </button>
                <button
                  onClick={() => save(item.key)}
                  disabled={busy === item.key || !dirty.has(item.key)}
                  className="px-2 py-1 text-xs rounded border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-30"
                >
                  <Save className="w-3 h-3 inline" /> {dirty.has(item.key) ? 'Save' : 'Saved'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={add} className="p-4 border border-dashed border-white/[0.08] rounded-xl space-y-2">
        <p className="text-xs text-white/50 flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add a new content key</p>
        <div className="grid grid-cols-2 gap-2">
          <input
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            placeholder="key.dot.notation"
            className="px-2 py-1.5 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-white focus:outline-none focus:border-white/20 font-mono"
          />
          <input
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="px-2 py-1.5 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-white focus:outline-none focus:border-white/20"
          />
        </div>
        <textarea
          value={newValue}
          onChange={e => setNewValue(e.target.value)}
          placeholder="Value"
          rows={3}
          className="w-full px-2 py-1.5 bg-white/[0.03] border border-white/[0.08] rounded text-sm text-white focus:outline-none focus:border-white/20"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy === '__new' || !newKey.trim()}
            className="px-3 py-1.5 text-xs rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-50"
          >
            {busy === '__new' ? 'Adding…' : 'Add content key'}
          </button>
        </div>
      </form>
    </div>
  );
}
