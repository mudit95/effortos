'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, Share, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import * as storage from '@/lib/storage';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** ≥3 sessions before we surface the prompt. Activation research:
 *  - 1 session: too early; user is still evaluating
 *  - 5+ sessions: missed the activation window; user already
 *    established the workflow on web
 *  - 3 is the sweet spot. */
const SESSION_THRESHOLD = 3;

/** iOS Safari has no beforeinstallprompt event; we render an
 *  instructional variant ("tap Share → Add to Home Screen") for it. */
function isIOSSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIOS && isSafari;
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  // iOS detection runs once at mount via lazy init — synchronous
  // capability check, not an external system to subscribe to. Avoids
  // the setState-in-effect warning we'd hit if we set this from
  // inside the beforeinstallprompt useEffect.
  const [iosFlow] = useState<boolean>(() => isIOSSafari());
  // Lazy initialiser reads matchMedia once at mount. That sidesteps the
  // React 19 "setState in effect body" warning we'd hit if we synced the
  // install state into React via a second render.
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return (
        window.matchMedia('(display-mode: standalone)').matches ||
        // Legacy iOS standalone flag
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true
      );
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (isInstalled) return;

    // Activation gate: don't surface the prompt to users who haven't
    // established the workflow yet. Read session count from local
    // storage (cheap, no network); if below threshold, exit.
    const sessionCount = storage.getCompletedSessions('').length;
    if (sessionCount < SESSION_THRESHOLD) return;

    // Check if user dismissed before
    const dismissed = localStorage.getItem('effortos_pwa_dismissed');
    if (dismissed) {
      const ago = Date.now() - parseInt(dismissed, 10);
      // Don't show again for 14 days after dismiss
      if (ago < 14 * 24 * 60 * 60 * 1000) return;
    }

    // iOS Safari path: no beforeinstallprompt event ever fires; we
    // surface an instructional card immediately (gated on session
    // threshold + dismissal already checked above). iosFlow itself
    // is set via the lazy initializer above; here we just schedule
    // the banner reveal.
    if (iosFlow) {
      const t = setTimeout(() => setShowBanner(true), 1500);
      return () => clearTimeout(t);
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Show banner after a small delay so it doesn't flash on load
      timeoutId = setTimeout(() => setShowBanner(true), 3000);
    };

    const onInstalled = () => {
      setIsInstalled(true);
      setShowBanner(false);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', onInstalled);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isInstalled, iosFlow]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
    setShowBanner(false);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem('effortos_pwa_dismissed', Date.now().toString());
  };

  if (isInstalled) return null;

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-50"
        >
          <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl p-4 shadow-2xl backdrop-blur-xl">
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                <Download className="w-5 h-5 text-white" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-white mb-0.5">Install EffortOS</h4>
                <p className="text-xs text-white/40 leading-relaxed">
                  Add to your dock for quick access. Works offline and stays on top while you work.
                </p>
              </div>

              {/* Close */}
              <button
                onClick={handleDismiss}
                className="text-white/20 hover:text-white/50 transition-colors p-0.5 flex-shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Actions */}
            {iosFlow ? (
              <div className="mt-3 text-xs text-white/55 leading-relaxed space-y-1.5">
                <p className="font-medium text-white/80 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-cyan-300" />
                  In Safari, just two taps:
                </p>
                <p>
                  1. Tap the <Share className="inline w-3 h-3 align-text-bottom" />{' '}
                  <span className="font-semibold text-white">Share</span> button.
                </p>
                <p>
                  2. Scroll, then tap <span className="font-semibold text-white">Add to Home Screen</span>.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-3">
                <Button
                  variant="glow"
                  size="sm"
                  onClick={handleInstall}
                  className="flex-1 gap-1.5 text-xs h-8"
                >
                  <Download className="w-3.5 h-3.5" />
                  Install App
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDismiss}
                  className="text-xs h-8 px-3"
                >
                  Later
                </Button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
