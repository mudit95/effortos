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
import { PWAInstallPrompt } from '@/components/pwa/PWAInstallPrompt';
import { ToastContainer } from '@/components/ui/toast';
import { applyTheme, getStoredTheme } from '@/components/dashboard/SettingsModal';
import { useServiceWorker } from '@/hooks/useServiceWorker';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { createClient } from '@/lib/supabase/client';
import { Sparkles } from 'lucide-react';

export function AppShell() {
  const { currentView, isLoading, initializeApp } = useStore();
  const dashboardMode = useStore(s => s.dashboardMode);

  // Register service worker for PWA
  useServiceWorker();

  // Subscribe to Supabase Realtime for cross-device sync
  useRealtimeSync();

  useEffect(() => {
    initializeApp();
    // Apply stored theme on load
    const theme = getStoredTheme();
    applyTheme(theme);

    // Listen for Supabase auth state changes (sign-in, sign-out, token refresh)
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: string) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          initializeApp();
        } else if (event === 'SIGNED_OUT') {
          initializeApp();
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [initializeApp]);

  useEffect(() => {
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
  }, [currentView, dashboardMode]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0F14]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center animate-pulse">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <p className="text-sm text-white/30">Loading EffortOS...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <>
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

      {/* PiP overlay — renders timer into floating PiP window when active */}
      <PiPTimerOverlay />

      {/* PWA install prompt — shows on eligible browsers */}
      <PWAInstallPrompt />

      <ToastContainer />
    </>
  );
}
