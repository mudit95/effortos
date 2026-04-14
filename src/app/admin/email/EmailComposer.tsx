'use client';

import React, { useState } from 'react';
import { Send, Users, UserCheck, UserX, User, Loader2 } from 'lucide-react';

const TARGETS = [
  { value: 'all', label: 'All users', icon: Users, desc: 'Everyone with an account' },
  { value: 'active', label: 'Active & trialing', icon: UserCheck, desc: 'Paying or in trial' },
  { value: 'expired', label: 'Expired / cancelled', icon: UserX, desc: 'Churned or past_due' },
  { value: 'trialing', label: 'Trialing only', icon: User, desc: 'In free trial' },
  { value: 'individual', label: 'Individual', icon: User, desc: 'Specific email(s)' },
];

export function EmailComposer() {
  const [target, setTarget] = useState('all');
  const [emails, setEmails] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [ctaText, setCtaText] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; total: number; errors?: string[] } | null>(null);

  async function handleSend() {
    if (!subject.trim() || !body.trim()) return;
    if (target === 'individual' && !emails.trim()) return;

    setSending(true);
    setResult(null);

    try {
      const res = await fetch('/api/admin/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          emails: target === 'individual' ? emails.split(',').map(e => e.trim()).filter(Boolean) : undefined,
          subject: subject.trim(),
          body: body.trim(),
          ctaText: ctaText.trim() || undefined,
          ctaUrl: ctaUrl.trim() || undefined,
        }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ sent: 0, total: 0, errors: ['Network error'] });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 space-y-5">
      <h3 className="text-lg font-semibold">Compose email</h3>

      {/* Target selector */}
      <div>
        <label className="block text-xs text-white/40 mb-2">Send to</label>
        <div className="flex flex-wrap gap-2">
          {TARGETS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.value}
                onClick={() => setTarget(t.value)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                  target === t.value
                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400'
                    : 'border-white/[0.06] text-white/50 hover:border-white/[0.12]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-white/30 mt-1">
          {TARGETS.find(t => t.value === target)?.desc}. Respects email preferences.
        </p>
      </div>

      {/* Individual emails */}
      {target === 'individual' && (
        <div>
          <label className="block text-xs text-white/40 mb-1">Email addresses (comma-separated)</label>
          <input
            type="text"
            value={emails}
            onChange={e => setEmails(e.target.value)}
            placeholder="user@example.com, other@example.com"
            className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded-lg text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/30"
          />
        </div>
      )}

      {/* Subject */}
      <div>
        <label className="block text-xs text-white/40 mb-1">Subject</label>
        <input
          type="text"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Your subject line..."
          className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded-lg text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/30"
        />
      </div>

      {/* Body */}
      <div>
        <label className="block text-xs text-white/40 mb-1">Body (use blank lines for paragraph breaks)</label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Write your message here. Use blank lines between paragraphs."
          rows={8}
          className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded-lg text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/30 resize-y"
        />
      </div>

      {/* CTA (optional) */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-white/40 mb-1">Button text (optional)</label>
          <input
            type="text"
            value={ctaText}
            onChange={e => setCtaText(e.target.value)}
            placeholder="e.g., Start your trial"
            className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded-lg text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/30"
          />
        </div>
        <div>
          <label className="block text-xs text-white/40 mb-1">Button URL</label>
          <input
            type="text"
            value={ctaUrl}
            onChange={e => setCtaUrl(e.target.value)}
            placeholder="https://..."
            className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded-lg text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/30"
          />
        </div>
      </div>

      {/* Send */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSend}
          disabled={sending || !subject.trim() || !body.trim()}
          className="flex items-center gap-2 px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-sm rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {sending ? 'Sending...' : 'Send email'}
        </button>

        {result && (
          <p className={`text-sm ${result.errors && result.errors.length > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
            Sent {result.sent}/{result.total}
            {result.errors && result.errors.length > 0 && ` (${result.errors.length} errors)`}
          </p>
        )}
      </div>
    </div>
  );
}
