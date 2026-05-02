'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Share2, X, Check, Copy, MessageCircle } from 'lucide-react';

/**
 * Share-streak CTA — small icon button that opens a share sheet popover.
 *
 * Placed in/near the streak chip on the dashboard. Tapping it lazy-mints
 * the user's share token (server-side, idempotent) and surfaces:
 *   - The full share URL with copy button
 *   - WhatsApp / Twitter / X share intents
 *   - "Revoke link" action so the URL stops working immediately
 *
 * Stays a popover (not a modal) — sharing a streak is a low-stakes,
 * one-handed mobile action, not a context-switch.
 *
 * The token is fetched on-demand at first tap (saves an extra network
 * hop for users who never share). After the first fetch we keep the
 * URL in component state so tapping again is instant.
 */

interface ShareStreakButtonProps {
  /** Optional className passthrough so the button can be sized/coloured by caller. */
  className?: string;
  /** Caller's display name — used to populate the share message. */
  displayName?: string;
  /** Current streak count — used in the WhatsApp / X share copy. */
  currentStreak?: number;
}

export function ShareStreakButton({
  className,
  displayName,
  currentStreak,
}: ShareStreakButtonProps) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchToken = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/share/streak', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { url: string | null } = await res.json();
      setUrl(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load share link');
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = async () => {
    setOpen(true);
    if (!url && !loading) {
      await fetchToken();
    }
  };

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — please copy manually');
    }
  };

  const shareMessage = (() => {
    const name = displayName || 'I';
    if (typeof currentStreak === 'number' && currentStreak > 0) {
      return `${name === 'I' ? "I'm" : `${name} is`} on a ${currentStreak}-day focus streak with EffortOS. Build your own:`;
    }
    return `${name === 'I' ? "I'm" : `${name} is`} building a focus streak with EffortOS:`;
  })();

  const whatsappHref = url
    ? `https://wa.me/?text=${encodeURIComponent(`${shareMessage} ${url}`)}`
    : '#';
  const twitterHref = url
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareMessage)}&url=${encodeURIComponent(url)}`
    : '#';

  const handleRevoke = async () => {
    setLoading(true);
    try {
      await fetch('/api/share/streak', { method: 'DELETE' });
      setUrl(null);
    } catch {
      setError('Failed to revoke');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={handleOpen}
        className={
          className ||
          'inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors px-2 py-1 rounded-md hover:bg-white/[0.04]'
        }
        aria-label="Share streak"
      >
        <Share2 className="w-3.5 h-3.5" />
        <span>Share</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop — closes the popover on outside click */}
            <button
              type="button"
              aria-label="Close share menu"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="absolute right-0 top-full mt-2 z-50 w-80 rounded-xl border border-white/[0.08] bg-[#0F141B] shadow-2xl shadow-black/60 p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-white/85">Share your streak</h4>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="text-white/40 hover:text-white/70"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {loading && !url && (
                <div className="text-xs text-white/40 py-3 text-center">Generating link…</div>
              )}

              {error && (
                <div className="text-xs text-red-400/80 mb-3">{error}</div>
              )}

              {url && (
                <>
                  {/* URL with inline copy */}
                  <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <span className="flex-1 text-[11px] text-white/55 font-mono truncate">
                      {url.replace(/^https?:\/\//, '')}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="text-xs text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded inline-flex items-center gap-1"
                    >
                      {copied ? (
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

                  {/* Native share buttons */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <a
                      href={whatsappHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[#25D366]/10 border border-[#25D366]/30 text-[#25D366] hover:bg-[#25D366]/20 transition-colors"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      WhatsApp
                    </a>
                    <a
                      href={twitterHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/70 hover:bg-white/[0.06] transition-colors"
                    >
                      <span aria-hidden="true">𝕏</span>
                      X / Twitter
                    </a>
                  </div>

                  <button
                    type="button"
                    onClick={handleRevoke}
                    disabled={loading}
                    className="text-[11px] text-white/30 hover:text-red-400/70 transition-colors disabled:opacity-50"
                  >
                    Revoke this link
                  </button>
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
