'use client';

import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { LandingPage } from './LandingPage';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { Dashboard } from '@/components/dashboard/Dashboard';
import { FocusMode } from '@/components/timer/FocusMode';
import { PiPTimerOverlay } from '@/components/timer/PiPTimerOverlay';
import { TimerEngine } from '@/components/timer/TimerEngine';
import { PWAInstallPrompt } from '@/components/pwa/PWAInstallPrompt';
import { ToastContainer } from '@/components/ui/toast';
import { ConnectionBanner } from '@/components/layout/ConnectionBanner';
import { applyTheme, getStoredTheme } from '@/components/dashboard/SettingsModal';
import { useServiceWorker } from '@/hooks/useServiceWorker';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { createClient } from '@/lib/supabase/client';
import { warmUpAudio } from '@/lib/sounds';
import { Sparkles } from 'lucide-react';

export function AppShell() {
  // Per-field selectors. `useStore()` (no selector) subscribes to every
  // store change including timer ticks, which would force AppShell to
  // re-render every 250 ms even though its render output doesn't depend
  // on timeRemaining.
  const currentView = useStore(s => s.currentView);
  const isLoading = useStore(s => s.isLoading);
  const initializeApp = useStore(s => s.initializeApp);
  const dashboardMode = useStore(s => s.dashboardMode);
  // TimerEngine controls document.title while a session is active so the
  // browser tab shows the live countdown. We listen on timerState here so
  // that when the timer goes idle the view-based title is restored — the
  // effect would otherwise not re-fire (its other deps haven't changed).
  const timerState = useStore(s => s.timerState);

  // Register service worker for PWA
  useServiceWorker();

  // Subscribe to Supabase Realtime for cross-device sync
  useRealtimeSync();

  useEffect(() => {
    initializeApp();
    // Apply stored theme on load
    const theme = getStoredTheme();
    applyTheme(theme);
    // Prime the AudioContext on the very first user interaction (click,
    // keypress, touch). Without this the dashboard's complete chimes —
    // which fire from the worker callback long after any user gesture —
    // are silently blocked by the browser autoplay policy. FocusMode and
    // MeditationScreen used to be the only places that called this; that
    // meant users who only ever sat in the dashboard had a permanently
    // suspended AudioContext and no sound. Calling once here at app boot
    // makes the gesture-aware listener present everywhere from the start.
    warmUpAudio();

    // Listen for Supabase auth state changes.
    //
    // Three events fire shortly after a successful login (INITIAL_SESSION,
    // SIGNED_IN, TOKEN_REFRESHED). Triggering initializeApp() on all three
    // used to start parallel inits that raced on store writes — the
    // proximate cause of "auth sometimes works, sometimes doesn't."
    //
    // The store now has a single-flight guard, so concurrent calls collapse
    // to one in-flight promise. We still narrow the listener to:
    //   - INITIAL_SESSION: needed on hard refresh to rehydrate from cookie.
    //   - SIGNED_IN: needed for fresh OAuth/email sign-in.
    //   - TOKEN_REFRESHED: NOT a re-init trigger. The cookie is already
    //     refreshed by the supabase client — there's nothing for the app
    //     to do except keep going.
    let subscription: { unsubscribe: () => void } | null = null;
    try {
      const supabase = createClient();
      const { data } = supabase.auth.onAuthStateChange(
        (event: string, session: { user?: unknown } | null) => {
          if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
            if (session?.user) {
              initializeApp();
            }
          }
          // SIGNED_OUT is handled by the logout() action — no need to re-initialize.
          // TOKEN_REFRESHED is intentionally ignored — see comment block above.
        }
      );
      subscription = data.subscription;
    } catch (err) {
      console.warn('Supabase auth listener setup failed:', err);
    }

    return () => {
      subscription?.unsubscribe();
    };
  }, [initializeApp]);

  // Re-fetch subscription status when the tab regains focus — catches
  // admin-granted upgrades, Razorpay webhook confirmations, etc. without
  // requiring a full page reload.
  useEffect(() => {
    const onFocus = () => {
      const state = useStore.getState();
      if (state.isAuthenticated && state.user) {
        state.fetchSubscriptionStatus();
      }
    };
    window.addEventListener('focus', onFocus);
    // Also poll every 5 minutes in case the tab stays focused
    const interval = setInterval(onFocus, 5 * 60 * 1000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    // TimerEngine owns document.title during active sessions (running /
    // paused / break). We only set the view title when the timer is idle.
    if (timerState !== 'idle') return;
    if (currentView === 'dashboard') {
      const modeLabels: Record<string, string> = {
        daily: 'Daily Grind',
        longterm: 'Long Term',
        reports: 'Reports',
      };
      document.title = `${modeLabels[dashboardMode] || 'Dashboard'} — EffortOS`;
    } else {
      const titles: Record<string, string> = {
        landing: 'EffortOS — AI-Powered Effort Tracking',
        auth: 'Sign In — EffortOS',
        onboarding: 'Set Your Goal — EffortOS',
        focus: 'Focus Mode — EffortOS',
      };
      document.title = titles[currentView] || 'EffortOS';
    }
  }, [currentView, dashboardMode, timerState]);

  if (isLoading) {
    return <BootLoader />;
  }

  return (
    <>
      {/* Sticky outage banner — auto-shows when the store flips into 'degraded'.
          Sits above all views so it doesn't steal layout from the dashboard. */}
      <ConnectionBanner />

      <AnimatePresence mode="wait">
        <motion.div
          key={currentView}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {currentView === 'landing' && <LandingPage />}
          {currentView === 'auth' && <AuthScreen />}
          {currentView === 'onboarding' && <OnboardingFlow />}
          {currentView === 'dashboard' && <Dashboard />}
          {currentView === 'focus' && <FocusMode />}
        </motion.div>
      </AnimatePresence>

      {/* Singleton timer engine — owns the Web Worker, syncs ticks into the
          store, and drives the live tab title. Mounted once here so every
          consumer of useTimer() shares one engine instead of spawning four. */}
      <TimerEngine />

      {/* PiP overlay — renders timer into floating PiP window when active */}
      <PiPTimerOverlay />

      {/* PWA install prompt — shows on eligible browsers */}
      <PWAInstallPrompt />

      <ToastContainer />
    </>
  );
}

/**
 * Boot screen.
 *
 * The default state is the calm "loading" splash. After 6 seconds without
 * resolution we switch to a "slow connection" mode with an explicit retry CTA
 * so the user is never stuck on an indefinite spinner. The store's own 3-second
 * safety net in initializeApp will usually have already kicked us to landing
 * before this hits, but if both Supabase auth AND that timer are blocked,
 * this is our last UX line.
 */
function BootLoader() {
  const [stalled, setStalled] = React.useState(false);
  const initializeApp = useStore((s) => s.initializeApp);

  React.useEffect(() => {
    const t = setTimeout(() => setStalled(true), 6_000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B0F14] p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center gap-4 max-w-sm text-center"
      >
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center animate-pulse">
          <Sparkles className="w-6 h-6 text-white" />
        </div>
        {!stalled ? (
          <p className="text-sm text-white/30">Loading EffortOS...</p>
        ) : (
          <>
            <p className="text-sm text-white/70 leading-relaxed">
              Taking longer than usual to reach the server.
              <br />
              <span className="text-white/40">Your local data is safe.</span>
            </p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  setStalled(false);
                  initializeApp();
                }}
                className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm transition"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 text-sm transition"
              >
                Reload
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
