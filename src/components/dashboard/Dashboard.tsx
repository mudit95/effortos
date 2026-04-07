'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { Card, CardTitle, CardValue } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EffortRing } from './EffortRing';
import { TrajectoryGraph } from './TrajectoryGraph';
import { ConsistencyGrid } from './ConsistencyGrid';
import { ProjectionPanel } from './ProjectionPanel';
import { MilestoneTracker } from './MilestoneTracker';
import { FeedbackModal } from './FeedbackModal';
import { SessionNotesModal } from './SessionNotesModal';
import { CelebrationScreen } from './CelebrationScreen';
import { SettingsModal } from './SettingsModal';
import { GoalHistoryModal } from './GoalHistoryModal';
import { EditGoalModal } from './EditGoalModal';
import { ManualSessionModal } from './ManualSessionModal';
import { ModeToggle } from './ModeToggle';
import { GoalSelector } from './GoalSelector';
import { DailyGrind } from './DailyGrind';
import { Reports } from './Reports';
import { TimerDisplay } from '@/components/timer/TimerDisplay';
import { sessionsToHours } from '@/lib/utils';
import {
  Target, Clock, Flame, TrendingUp, LogOut, Plus,
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
  } = useStore();

  useEffect(() => {
    refreshDashboard();
    requestNotificationPermission();
  }, [refreshDashboard, requestNotificationPermission]);

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
            </div>
          </div>
        </div>
        <GoalHistoryModal />
        <SettingsModal />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-8">
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
              <DailyGrind />
            </motion.div>
          ) : dashboardMode === 'reports' ? (
            <motion.div
              key="reports"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25, ease }}
            >
              <Reports />
            </motion.div>
          ) : (
            <motion.div
              key="longterm"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25, ease }}
            >
              {activeGoal && dashboardStats ? (
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
  dashboardStats: NonNullable<ReturnType<typeof useStore.getState>['dashboardStats']>;
  setView: (view: 'focus') => void;
  setShowEditGoal: (show: boolean) => void;
  setShowManualSession: (show: boolean) => void;
  setShowGoalHistory: (show: boolean) => void;
}) {
  return (
    <>
      {/* Goal list */}
      <GoalSelector />

      {/* Review all goals button */}
      <motion.div {...fadeUp()} className="mb-4">
        <button
          onClick={() => setShowGoalHistory(true)}
          className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors px-1"
        >
          <List className="w-3.5 h-3.5" />
          Review All Long Term Goals
        </button>
      </motion.div>

      {/* Goal title bar */}
      <motion.div {...fadeUp()} className="flex items-start justify-between mb-6 sm:mb-8">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-white/30 uppercase tracking-wider mb-1">Current Goal</p>
          <h1 className="text-lg sm:text-xl font-bold text-white leading-tight truncate pr-4">
            {activeGoal.title}
          </h1>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button variant="ghost" size="icon" onClick={() => setShowEditGoal(true)} className="w-8 h-8" aria-label="Edit goal">
            <Edit3 className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowManualSession(true)} className="w-8 h-8" aria-label="Log manual session">
            <PlusCircle className="w-3.5 h-3.5" />
          </Button>
        </div>
      </motion.div>

      {/* Confidence banner */}
      {activeGoal.confidence_score < 0.5 && (
        <motion.div
          {...fadeUp(0.05)}
          className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-yellow-500/5 border border-yellow-500/10 rounded-xl"
        >
          <Shield className="w-4 h-4 text-yellow-400 flex-shrink-0" />
          <p className="text-xs text-yellow-400/70">
            This estimate has low confidence ({Math.round(activeGoal.confidence_score * 100)}%). It will improve as you complete more sessions.
          </p>
        </motion.div>
      )}

      {/* Responsive layout: stacked on mobile/tablet, 3-col on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">

        {/* LEFT: Stats + Milestones */}
        <div className="lg:col-span-3 order-2 lg:order-1 space-y-4 sm:space-y-6">
          <motion.div {...fadeUp(0.1)}>
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
              <Card variant="default">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-cyan-400" />
                  <CardTitle>Sessions Done</CardTitle>
                </div>
                <CardValue>
                  {dashboardStats.sessions_done}
                  <span className="text-sm text-white/30 font-normal"> / {activeGoal.estimated_sessions_current}</span>
                </CardValue>
                <p className="text-xs text-white/20 mt-1">{dashboardStats.total_hours}h invested</p>
              </Card>

              <Card variant="default">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-400" />
                  <CardTitle>Streak</CardTitle>
                </div>
                <CardValue>
                  {dashboardStats.current_streak}
                  <span className="text-sm text-white/30 font-normal"> days</span>
                </CardValue>
                {dashboardStats.longest_streak > 0 && (
                  <p className="text-xs text-white/20 mt-1">Best: {dashboardStats.longest_streak} days</p>
                )}
              </Card>

              <Card variant="default">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-400" />
                  <CardTitle>Confidence</CardTitle>
                </div>
                <CardValue>
                  {Math.round(activeGoal.confidence_score * 100)}
                  <span className="text-sm text-white/30 font-normal">%</span>
                </CardValue>
                <p className="text-xs text-white/20 mt-1">{activeGoal.difficulty} difficulty</p>
              </Card>

              <Card variant="default" className="lg:hidden">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-400" />
                  <CardTitle>Remaining</CardTitle>
                </div>
                <CardValue>
                  {dashboardStats.sessions_remaining}
                  <span className="text-sm text-white/30 font-normal"> sess</span>
                </CardValue>
                <p className="text-xs text-white/20 mt-1">~{sessionsToHours(dashboardStats.sessions_remaining)}h left</p>
              </Card>
            </div>
          </motion.div>

          <motion.div {...fadeUp(0.2)} className="hidden lg:block">
            <MilestoneTracker
              milestones={activeGoal.milestones}
              sessionsCompleted={activeGoal.sessions_completed}
            />
          </motion.div>
        </div>

        {/* CENTER: Timer + Ring */}
        <div className="lg:col-span-5 order-1 lg:order-2 space-y-4 sm:space-y-6">
          <motion.div
            {...fadeUp(0.15)}
            className="flex flex-col items-center"
          >
            <EffortRing
              percentage={dashboardStats.completion_percentage}
              initialEstimate={activeGoal.estimated_sessions_initial}
              currentEstimate={activeGoal.estimated_sessions_current}
              sessionsCompleted={activeGoal.sessions_completed}
              size={240}
              className="sm:scale-110"
            />

            <div className="mt-6 sm:mt-8 w-full flex justify-center">
              <TimerDisplay onEnterFocus={() => setView('focus')} />
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView('focus')}
              className="mt-3 gap-1 text-xs text-white/30 hover:text-white/60"
            >
              Enter Focus Mode
              <ChevronRight className="w-3 h-3" />
            </Button>
          </motion.div>
        </div>

        {/* RIGHT: Analytics */}
        <div className="lg:col-span-4 order-3 space-y-4 sm:space-y-6">
          <motion.div {...fadeUp(0.2)}>
            <ProjectionPanel goal={activeGoal} stats={dashboardStats} />
          </motion.div>

          <motion.div {...fadeUp(0.25)}>
            <TrajectoryGraph goal={activeGoal} />
          </motion.div>

          <motion.div {...fadeUp(0.3)}>
            <ConsistencyGrid dailySessions={dashboardStats.daily_sessions} />
          </motion.div>

          {/* Milestones for mobile */}
          <motion.div {...fadeUp(0.35)} className="lg:hidden">
            <MilestoneTracker
              milestones={activeGoal.milestones}
              sessionsCompleted={activeGoal.sessions_completed}
            />
          </motion.div>
        </div>
      </div>
    </>
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
