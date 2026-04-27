'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  Users, Plus, Copy, Check, UserMinus,
  Flame, Calendar, Loader2,
} from 'lucide-react';

interface Pact {
  id: string;
  user_id: string;
  partner_email: string;
  partner_user_id: string | null;
  invite_code: string;
  status: 'pending' | 'active' | 'declined' | 'ended';
  created_at: string;
  accepted_at: string | null;
  partner?: {
    user_id: string;
    name: string | null;
    active_days_7d: number;
    sessions_7d: number;
  } | null;
}

export function PactsSection() {
  const [pacts, setPacts] = useState<Pact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPacts = useCallback(async () => {
    try {
      const res = await fetch('/api/pacts');
      if (res.ok) {
        const data = await res.json();
        setPacts(data.pacts || []);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPacts(); }, [fetchPacts]);

  const createPact = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/pacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_email: email }),
      });
      if (res.ok) {
        setInviteEmail('');
        setShowInvite(false);
        fetchPacts();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create pact');
      }
    } catch {
      setError('Network error');
    } finally {
      setSending(false);
    }
  };

  const acceptPact = async () => {
    const code = joinCode.trim();
    if (!code) return;
    setJoining(true);
    setError(null);
    try {
      const res = await fetch('/api/pacts/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code: code }),
      });
      if (res.ok) {
        setJoinCode('');
        fetchPacts();
      } else {
        const data = await res.json();
        setError(data.error || 'Invalid invite code');
      }
    } catch {
      setError('Network error');
    } finally {
      setJoining(false);
    }
  };

  const endPact = async (pactId: string) => {
    if (!confirm('End this accountability pact?')) return;
    try {
      const res = await fetch('/api/pacts/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pact_id: pactId }),
      });
      if (res.ok) fetchPacts();
    } catch {}
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const activePacts = pacts.filter(p => p.status === 'active');
  const pendingPacts = pacts.filter(p => p.status === 'pending');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-medium text-white/80">Accountability Pacts</h3>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowInvite(!showInvite)}
            className="text-xs gap-1"
          >
            <Plus className="w-3 h-3" />
            Invite
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-white/30">
        Partner up with a friend. You&apos;ll see each other&apos;s streaks and weekly activity — nothing else.
      </p>

      {/* Error display */}
      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>
      )}

      {/* Invite form */}
      <AnimatePresence>
        {showInvite && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3">
              <div>
                <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">
                  Send invite
                </label>
                <div className="flex gap-2">
                  <input
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createPact()}
                    placeholder="partner@email.com"
                    className="flex-1 px-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/20"
                  />
                  <Button
                    variant="glow"
                    size="sm"
                    onClick={createPact}
                    disabled={sending || !inviteEmail.trim()}
                  >
                    {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Send'}
                  </Button>
                </div>
              </div>

              <div className="border-t border-white/[0.04] pt-3">
                <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1.5">
                  Or join with invite code
                </label>
                <div className="flex gap-2">
                  <input
                    value={joinCode}
                    onChange={e => setJoinCode(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && acceptPact()}
                    placeholder="Paste invite code..."
                    className="flex-1 px-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/20 font-mono text-xs"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={acceptPact}
                    disabled={joining || !joinCode.trim()}
                  >
                    {joining ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Join'}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-4 h-4 text-white/20 animate-spin" />
        </div>
      )}

      {/* Active pacts */}
      {activePacts.map(pact => (
        <div
          key={pact.id}
          className="p-3 rounded-xl border border-purple-500/10 bg-purple-500/[0.03]"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-white/80">
              {pact.partner?.name || pact.partner_email}
            </p>
            <button
              onClick={() => endPact(pact.id)}
              className="text-white/15 hover:text-red-400 transition-colors"
              title="End pact"
            >
              <UserMinus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex gap-4 text-xs">
            <div className="flex items-center gap-1.5 text-white/50">
              <Calendar className="w-3 h-3 text-purple-400/60" />
              <span>
                <strong className="text-white/70">{pact.partner?.active_days_7d ?? '?'}</strong> active days (7d)
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-white/50">
              <Flame className="w-3 h-3 text-orange-400/60" />
              <span>
                <strong className="text-white/70">{pact.partner?.sessions_7d ?? '?'}</strong> sessions (7d)
              </span>
            </div>
          </div>
        </div>
      ))}

      {/* Pending pacts */}
      {pendingPacts.map(pact => (
        <div
          key={pact.id}
          className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white/60">{pact.partner_email}</p>
              <p className="text-[10px] text-white/25 mt-0.5">Waiting for them to accept</p>
            </div>
            <button
              onClick={() => copyCode(pact.invite_code)}
              className="flex items-center gap-1 text-[10px] text-white/30 hover:text-cyan-400 transition-colors px-2 py-1 rounded bg-white/[0.03]"
              title="Copy invite code to share"
            >
              {copied === pact.invite_code ? (
                <><Check className="w-3 h-3" /> Copied</>
              ) : (
                <><Copy className="w-3 h-3" /> Code</>
              )}
            </button>
          </div>
        </div>
      ))}

      {/* Empty state */}
      {!loading && pacts.length === 0 && !showInvite && (
        <div className="text-center py-6">
          <Users className="w-8 h-8 text-white/10 mx-auto mb-2" />
          <p className="text-xs text-white/25">No pacts yet. Invite a friend to stay accountable together.</p>
        </div>
      )}
    </div>
  );
}
