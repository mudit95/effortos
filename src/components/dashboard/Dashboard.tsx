'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { EffortRing } from './EffortRing';
import { MilestoneTracker } from './MilestoneTracker';
import { GoalProgressBar } from './GoalProgressBar';
import { FeedbackModal } from './FeedbackModal';
import { SessionNotesModal } from './SessionNotesModal';
import { CelebrationScreen } from './CelebrationScreen';
import { SettingsModal } from './SettingsModal';
import { GoalHistoryModal } from './GoalHistoryModal';
import { EditGoalModal } from './EditGoalModal';
import { ManualSessionModal } from './ManualSessionModal';
import { JournalModal } from './JournalModal';
import { ShadowGoalsModal } from './ShadowGoalsModal';
import { ModeToggle } from './ModeToggle';
import { GoalSelector } from './GoalSelector';
import { WelcomeCard } from './WelcomeCard';
import { DailyGrind } from './DailyGrind';
import { Reports } from './Reports';
import { StreakCalendar } from './StreakCalendar';
import { TimezoneClock } from './TimezoneClock';
import { AIInsightCard, AIMotivationCard } from './AICards';
import { PaywallModal } from '@/components/subscription/PaywallModal';
import { TrialBanner } from '@/components/subscription/TrialBanner';
import { PremiumGate } from '@/components/subscription/PremiumGate';
import { TimerDisplay } from '@/components/timer/TimerDisplay';
import {
  Target, LogOut, Plus,
  Sparkles, Settings, ChevronRight, BookOpen, Edit3,
  PlusCircle, Shield, List
} from 'lucide-react';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];
const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, ease, delay },
});

export function Dashboard() {
  const {
    user, activeGoal, dashboardStats, dashboardMode,
    setView, refreshDashboard, logout,
    setShowSettings, setShowGoalHistory, setShowEditGoal, setShowManualSession,
    requestNotificationPermission,
    subscription, subscriptionLoading, setShowPaywall,
  } = useStore();

  // Check subscription — show paywall if expired
  const isExpired = !subscriptionLoading && subscription.status === 'expired';

  useEffect(() => {
    refreshDashboard();
    requestNotificationPermission();
  }, [refreshDashboard, requestNotificationPermission]);

  useEffect(() => {
    if (isExpired) {
      setShowPaywall(true);
    }
  }, [isExpired, setShowPaywall]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Sparkles className="w-8 h-8 text-cyan-500 animate-pulse" />
      </div>
    );
  }

  // No active goal AND in longterm mode
  const showNoGoal = !activeGoal && dashboardMode === 'longterm';

  if (showNoGoal) {
    return (
      <div className="min-h-screen flex flex-col">
        <DashboardHeader user={user} onLogout={logout} onSettings={() => setShowSettings(true)} onHistory={() => setShowGoalHistory(true)} />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 sm:mt-6 w-full">
          <div className="flex justify-center mb-6">
            <ModeToggle />
          </div>
        </main>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-6">
              <Target className="w-8 h-8 text-white/20" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">No active goal</h2>
            <p className="text-sm text-white/40 mb-6">
              Set a new goal or resume a paused one to get started.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                variant="glow"
                onClick={() => {
                  useStore.setState({
                    onboardingStep: 0,
                    onboardingData: {},
                    currentView: 'onboarding',
                  });
                }}
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                Start New Goal
              </Button>
              <Button variant="ghost" onClick={() => setShowGoalHistory(true)} className="gap-2">
                <BookOpen className="w-4 h-4" />
                View Goal History
              </Button>
              <Button
                variant="ghost"
                onClick={() => useStore.getState().setShowShadowGoals(true)}
                className="gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Shadow Goals
              </Button>
            </div>
          </div>
        </div>
        <GoalHistoryModal />
        <ShadowGoalsModal />
        <SettingsModal />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-8">
      <TrialBanner />
      <DashboardHeader
        user={user}
        onLogout={logout}
        onSettings={() => setShowSettings(true)}
        onHistory={() => setShowGoalHistory(true)}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 sm:mt-6">
        {/* Mode toggle — centered at top */}
        <div className="flex justify-center mb-6 sm:mb-8">
          <ModeToggle />
        </div>

        <AnimatePresence mode="wait">
          {dashboardMode === 'daily' ? (
            <motion.div
              key="daily"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25, ease }}
            >
              <PremiumGate label="Daily Planner" minHeight="400px">
                <DailyGrind />
              </PremiumGate>
            </motion.div>
          ) : dashboardMode === 'reports' ? (
            <motion.div
              key="reports"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25, ease }}
            >
              <PremiumGate label="Reports & Analytics" minHeight="400px">
                <Reports />
              </PremiumGate>
            </motion.div>
          ) : (
            <motion.div
              key="longterm"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25, ease }}
            >
              {activeGoal ? (
                <LongTermView
                  activeGoal={activeGoal}
                  dashboardStats={dashboardStats}
                  setView={setView}
                  setShowEditGoal={setShowEditGoal}
                  setShowManualSession={setShowManualSession}
                  setShowGoalHistory={setShowGoalHistory}
                />
              ) : !activeGoal ? (
                <div className="text-center py-16">
                  <div className="w-16 h-16 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-6">
                    <Target className="w-8 h-8 text-white/20" />
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">No active goal</h2>
                  <p className="text-sm text-white/40 mb-6">Set a goal to track your long-term progress.</p>
                  <div className="flex flex-col items-center gap-2">
                    <Button
                      variant="glow"
                      onClick={() => useStore.setState({ onboardingStep: 0, onboardingData: {}, currentView: 'onboarding' })}
                      className="gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Start New Goal
                    </Button>
                    <Button variant="ghost" onClick={() => setShowGoalHistory(true)} className="gap-2 text-xs">
                      <List className="w-3.5 h-3.5" />
                      Review All Goals
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-16">
                  <Sparkles className="w-8 h-8 text-cyan-500 animate-pulse" />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modals */}
      <FeedbackModal />
      <SessionNotesModal />
      <CelebrationScreen />
      <SettingsModal />
      <GoalHistoryModal />
      <EditGoalModal />
      <ManualSessionModal />
      <JournalModal />
      <ShadowGoalsModal />
      <PaywallModal />
    </div>
  );
}

// Extracted long-term dashboard view
function LongTermView({
  activeGoal,
  dashboardStats,
  setView,
  setShowEditGoal,
  setShowManualSession,
  setShowGoalHistory,
}: {
  activeGoal: NonNullable<ReturnType<typeof useStore.getState>['activeGoal']>;
  dashboardStats: ReturnType<typeof useStore.getState>['dashboardStats'];
  setView: (view: 'focus') => void;
  setShowEditGoal: (show: boolean) => void;
  setShowManualSession: (show: boolean) => void;
  setShowGoalHistory: (show: boolean) => void;
}) {
  const completionPct = dashboardStats?.completion_percentage ?? 0;

  return (
    <>
      {/* Goal list */}
      <GoalSelector />

      {/* Welcome card for first-time users */}
      <WelcomeCard />

      {/* Review all goals + shadow shelf — sibling affordances so discovery
          of the shelf piggybacks on the existing "review goals" path. */}
      <motion.div {...fadeUp()} className="mb-2 flex items-center gap-4">
        <button
          onClick={() => setShowGoalHistory(true)}
          className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors px-1"
        >
          <List className="w-3.5 h-3.5" />
          Review All Long Term Goals
        </button>
        <button
          onClick={() => useStore.getState().setShowShadowGoals(true)}
          className="flex items-center gap-1.5 text-xs text-white/30 hover:text-purple-200/80 transition-colors px-1"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Shadow Goals
        </button>
      </motion.div>

      {/* 3-column layout: Goal+Calendar (left) | Timer (center) | AI Cards (right) — all visible without scroll */}
      <motion.div {...fadeUp()} className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 mb-4">
        {/* Left column — Goal details + Streak Calendar */}
        <div className="lg:col-span-5 space-y-3">
          {/* Goal header */}
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] text-white/25 uppercase tracking-wider">Current Goal</p>
              <h1 className="text-base sm:text-lg font-semibold text-white truncate">{activeGoal.title}</h1>
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-2">
              <Button variant="ghost" size="icon" onClick={() => setShowEditGoal(true)} className="w-7 h-7" aria-label="Edit goal">
                <Edit3 className="w-3 h-3" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setShowManualSession(true)} className="w-7 h-7" aria-label="Log manual session">
                <PlusCircle className="w-3 h-3" />
              </Button>
            </div>
          </div>

          {/* Progress bar */}
          <GoalProgressBar
            sessionsCompleted={activeGoal.sessions_completed}
            sessionsTotal={activeGoal.estimated_sessions_current}
            milestones={activeGoal.milestones}
            onClick={() => useStore.getState().openGoalReport(activeGoal.id)}
          />

          {/* Stats line */}
          {dashboardStats && (
            <p className="text-xs text-white/30">
              {dashboardStats.sessions_done}/{activeGoal.estimated_sessions_current} sessions &middot; {dashboardStats.total_hours}h invested &middot; {dashboardStats.current_streak} day streak
            </p>
          )}

          {/* Streak Calendar */}
          <PremiumGate label="Streak Calendar" minHeight="200px">
            <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
              <LongTermStreakCalendar
                dailySessions={dashboardStats?.daily_sessions || []}
                recommendedDaily={activeGoal.recommended_sessions_per_day}
              />
            </div>
          </PremiumGate>
        </div>

        {/* Center column — Timer + controls */}
        <div className="lg:col-span-3 flex flex-col items-center justify-start pt-2">
          <TimerDisplay onEnterFocus={() => setView('focus')} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView('focus')}
            className="mt-3 gap-1 text-xs text-white/30 hover:text-white/60"
          >
            Enter Focus Mode
            <ChevronRight className="w-3 h-3" />
          </Button>
        </div>

        {/* Right column — AI Insight + Motivation stacked */}
        <div className="lg:col-span-4 space-y-4">
          <PremiumGate label="AI Insight" minHeight="140px">
            <AIInsightCard
              goalTitle={activeGoal.title}
              sessionsCompleted={activeGoal.sessions_completed}
              sessionsTotal={activeGoal.estimated_sessions_current}
              streakDays={dashboardStats?.current_streak ?? 0}
              context="longterm"
            />
          </PremiumGate>
          <PremiumGate label="AI Motivation" minHeight="140px">
            <AIMotivationCard
              goalTitle={activeGoal.title}
              sessionsCompleted={activeGoal.sessions_completed}
              sessionsTotal={activeGoal.estimated_sessions_current}
              streakDays={dashboardStats?.current_streak ?? 0}
              userName={useStore.getState().user?.name || 'there'}
            />
          </PremiumGate>
        </div>
      </motion.div>

      {/* Confidence banner */}
      {activeGoal.confidence_score < 0.5 && (
        <motion.div
          {...fadeUp(0.25)}
          className="mt-4 flex items-center gap-2 px-4 py-2.5 bg-yellow-500/5 border border-yellow-500/10 rounded-xl"
        >
          <Shield className="w-4 h-4 text-yellow-400 flex-shrink-0" />
          <p className="text-xs text-yellow-400/70">
            This estimate has low confidence ({Math.round(activeGoal.confidence_score * 100)}%). It will improve as you complete more sessions.
          </p>
        </motion.div>
      )}
    </>
  );
}

// Small wrapper around StreakCalendar that subscribes to journal state
// and wires click-to-open. Kept as its own component so the hook
// subscriptions for journal don't force LongTermView to re-render on
// every journal save (its other dependencies are coarse-grained).
function LongTermStreakCalendar({
  dailySessions,
  recommendedDaily,
}: {
  dailySessions: ReadonlyArray<{ date: string; count: number }>;
  recommendedDaily?: number;
}) {
  const focusDuration = useStore(s => s.user?.settings?.focus_duration ?? 25 * 60);
  const journalEntries = useStore(s => s.journalEntries);
  const setJournalModalDate = useStore(s => s.setJournalModalDate);

  const journalDates = React.useMemo(
    () => journalEntries.map(e => e.date),
    [journalEntries],
  );

  return (
    <StreakCalendar
      dailySessions={Array.from(dailySessions)}
      recommendedDaily={recommendedDaily}
      focusDurationSec={focusDuration}
      journalDates={journalDates}
      onDayClick={(date) => setJournalModalDate(date)}
    />
  );
}

// Header component
function DashboardHeader({ user, onLogout, onSettings, onHistory }: {
  user: { name: string };
  onLogout: () => void;
  onSettings: () => void;
  onHistory: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 bg-[var(--background,#0B0F14)]/80 backdrop-blur-xl border-b border-white/[0.04]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-white tracking-tight hidden sm:inline">EffortOS</span>
        </div>
        <div className="flex items-center gap-1">
          <TimezoneClock />
          <div className="w-px h-4 bg-white/[0.06] mx-1 hidden sm:block" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              useStore.setState({
                onboardingStep: 0,
                onboardingData: {},
                currentView: 'onboarding',
              });
            }}
            className="gap-1.5 text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Goal</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={onHistory} className="w-8 h-8" aria-label="Goal history">
            <BookOpen className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onSettings} className="w-8 h-8" aria-label="Settings">
            <Settings className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onLogout} className="w-8 h-8" aria-label="Logout">
            <LogOut className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </header>
  );
}
