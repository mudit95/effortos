'use client';

import React from 'react';
import { useStore } from '@/store/useStore';
import { Sparkles, X } from 'lucide-react';

const DEMO_EMAIL = 'demo@effortos.app';
const DISMISS_KEY = 'effortos:demo-banner-dismissed';

/**
 * "You're in demo mode — sign up to save your progress" banner.
 *
 * Demo users come in via `loginAsDemo` (Try Now from AuthScreen) — they get
 * a localStorage-only profile and a placeholder goal so they can poke around.
 * The previous flow had no in-product nudge to convert; demo users could
 * accumulate localStorage data forever and lose it on the next browser-data
 * clear without ever knowing they had a way to save it.
 *
 * This banner surfaces right under the Dashboard header for any user whose
 * email matches the demo sentinel. Dismissible per session via sessionStorage
 * so a user who's just here to look around isn't nagged on every page.
 */
export function DemoModeBanner() {
  const user = useStore((s) => s.user);
  const setView = useStore((s) => s.setView);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  if (!user || user.email !== DEMO_EMAIL || dismissed) return null;

  const dismiss = () => {
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(DISMISS_KEY, '1');
      } catch {
        // sessionStorage may be unavailable (private mode); fail soft.
      }
    }
    setDismissed(true);
  };

  return (
    <div
      className="mx-4 mt-4 mb-2 rounded-xl border border-cyan-400/20 bg-gradient-to-r from-cyan-400/10 to-blue-400/5 px-4 py-3 flex items-center gap-3"
      role="status"
    >
      <div className="w-8 h-8 rounded-full bg-cyan-400/15 border border-cyan-400/25 flex items-center justify-center flex-shrink-0">
        <Sparkles className="w-4 h-4 text-cyan-300" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-cyan-100">
          You&rsquo;re in demo mode
        </p>
        <p className="text-[11px] text-cyan-200/70 leading-relaxed">
          Your goals, sessions, and journal entries live only in this browser.
          Sign up to save your progress and sync across devices.
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => setView('auth')}
          className="text-xs font-semibold bg-cyan-500 text-slate-900 px-3 py-1.5 rounded-lg hover:bg-cyan-400 transition-colors"
        >
          Save my progress
        </button>
        <button
          onClick={dismiss}
          aria-label="Dismiss demo-mode banner"
          className="text-cyan-200/60 hover:text-cyan-100 transition-colors p-1"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
