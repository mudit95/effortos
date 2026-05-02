'use client';

import React, { useEffect, useState } from 'react';
import { Gift, Copy, Check, MessageCircle, Sparkles } from 'lucide-react';

/**
 * Invite Friends — referral panel inside SettingsModal.
 *
 * Lazily fetches /api/referral/code on mount; that endpoint is idempotent
 * (returns the existing code or mints a new one). Surfaces:
 *   - The user's personal code (e.g. EFFORTOS-MUDIT-A8K2)
 *   - A pre-formed share URL with ?ref=<code> for friends to click
 *   - WhatsApp / copy actions
 *   - Progress bar — N of 10 redemptions used
 *
 * The redemption-flow side of this lives in /api/coupons/redeem; when a
 * friend redeems the code, both sides get +1 month of premium (config-
 * urable per coupon row). The kickback is best-effort — friend never
 * waits on the referrer credit.
 */

interface ReferralInfo {
  code: string;
  url: string;
  redemption_count: number;
  max_redemptions: number;
  reward: { redeemer_months: number; referrer_months: number };
}

export function InviteFriendsSection() {
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'code' | 'url' | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/referral/code')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: ReferralInfo) => {
        if (!cancelled) setInfo(data);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = async (what: 'code' | 'url', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Could not copy — please copy manually');
    }
  };

  const shareMessage = info
    ? `I'm using EffortOS for focus & habit tracking. Use my code ${info.code} for ${info.reward.redeemer_months} month free: ${info.url}`
    : '';

  const whatsappHref = info
    ? `https://wa.me/?text=${encodeURIComponent(shareMessage)}`
    : '#';

  const remaining = info
    ? Math.max(0, info.max_redemptions - info.redemption_count)
    : 0;
  const usedPct = info
    ? Math.round((info.redemption_count / info.max_redemptions) * 100)
    : 0;

  return (
    <div className="pt-4 border-t border-white/[0.06]">
      <div className="flex items-center gap-2 mb-3">
        <Gift className="w-4 h-4 text-pink-400" />
        <h4 className="text-sm font-medium text-white/70">Invite Friends</h4>
      </div>

      {loading && (
        <div className="text-xs text-white/40">Generating your code…</div>
      )}

      {error && !info && (
        <div className="text-xs text-red-400/80">Couldn&apos;t load referral code: {error}</div>
      )}

      {info && (
        <>
          <p className="text-xs text-white/55 leading-relaxed mb-4">
            Share your code. When a friend redeems it, you both get{' '}
            <span className="text-white/85 font-semibold">
              {info.reward.referrer_months} month free
            </span>{' '}
            of premium.
          </p>

          {/* The code, prominent */}
          <div className="rounded-lg border border-pink-500/20 bg-pink-500/[0.04] p-3 mb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Sparkles className="w-3.5 h-3.5 text-pink-300/80 shrink-0" />
                <code className="text-sm font-mono font-semibold text-pink-200/90 truncate">
                  {info.code}
                </code>
              </div>
              <button
                type="button"
                onClick={() => handleCopy('code', info.code)}
                className="text-xs text-pink-300/80 hover:text-pink-200 px-2 py-1 rounded inline-flex items-center gap-1 shrink-0"
              >
                {copied === 'code' ? (
                  <>
                    <Check className="w-3 h-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Share URL */}
          <div className="rounded-lg bg-white/[0.02] border border-white/[0.05] p-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[11px] text-white/55 font-mono truncate">
                {info.url.replace(/^https?:\/\//, '')}
              </span>
              <button
                type="button"
                onClick={() => handleCopy('url', info.url)}
                className="text-xs text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded inline-flex items-center gap-1"
              >
                {copied === 'url' ? (
                  <>
                    <Check className="w-3 h-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[#25D366]/10 border border-[#25D366]/30 text-[#25D366] hover:bg-[#25D366]/20 transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Share on WhatsApp
            </a>
          </div>

          {/* Progress + cap */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-[10px] text-white/40">
              <span>
                {info.redemption_count} of {info.max_redemptions} friends joined
              </span>
              <span>{remaining} left</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-pink-500 to-cyan-400 transition-all"
                style={{ width: `${Math.min(100, usedPct)}%` }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
