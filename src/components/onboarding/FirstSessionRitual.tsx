'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowRight, Coffee, Wind, Timer, Zap } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import * as storage from '@/lib/storage';

/**
 * First-Session Ritual.
 *
 * Surfaces ONCE for users who finished onboarding but haven't completed
 * a single focus session yet. Guides them through:
 *
 *   Step 1 (Choose) — pick a daily task or quick-add a 1-pomodoro task.
 *                     Pre-commitment is the activation gate.
 *   Step 2 (Frame)  — 30 sec script: what 25 min looks like, "even 10
 *                     min counts", anti-perfection messaging.
 *   Step 3 (Start)  — explicit "Begin focus" button.
 *
 * After step 3 fires off the timer + navigates to Focus mode, the
 * dismissal flag is persisted so the ritual never reappears for this
 * user — even if their first session is abandoned.
 *
 * Why this is a separate component instead of bolted onto onboarding:
 *   - Onboarding completion ≠ first session. The user might create a
 *     goal, hit dashboard, get distracted. The ritual catches them on
 *     the FIRST dashboard load AFTER onboarding, when intent is highest.
 *   - It also catches the "deferred onboarding" path — users who
 *     skipped picking a goal during onboarding get a gentler nudge.
 *
 * UX principles encoded:
 *   - Single-screen, no branching navigation. There's one Forward at
 *     all times; "Skip" is a low-prominence text link.
 *   - Stakes-zero copy. We never use "should" or "must"; only "let's"
 *     and "even 5 min counts". Anti-perfectionism is explicit.
 *   - Visual rhythm matches the rest of the app — same gradient,
 *     same border radii, same Sparkles iconography. No "first time
 *     user" condescension.
 *   - Celebration at completion is in the existing completeTimerSession
 *     path; we don't build a parallel celebration here.
 *
 * Storage: dismissal flag is local-first via storage.markFirstRitualSeen
 * (we keep it in localStorage rather than a cloud column because the
 * ritual is browser-session-bound — a user starting fresh on a new
 * device deserves to see it again on that device).
 */

const SESSION_KEY = 'effortos:first_ritual_seen';

interface FirstSessionRitualProps {
  /** Called when the ritual successfully launches a session. */
  onLaunch: () => void;
  /** Called when the user dismisses without starting. */
  onDismiss: () => void;
}

export function FirstSessionRitual({ onLaunch, onDismiss }: FirstSessionRitualProps) {
  const user = useStore((s) => s.user);
  const dailyTasks = useStore((s) => s.dailyTasks);
  const dailyViewDate = useStore((s) => s.dailyViewDate);
  const addDailyTaskForDate = useStore((s) => s.addDailyTaskForDate);
  const setActiveDailyTask = useStore((s) => s.setActiveDailyTask);
  const setDashboardMode = useStore((s) => s.setDashboardMode);
  const setView = useStore((s) => s.setView);
  const startTimer = useStore((s) => s.startTimer);

  const [step, setStep] = useState<'choose' | 'frame' | 'launching'>('choose');
  const [pickedTaskId, setPickedTaskId] = useState<string | null>(null);
  const [quickTaskTitle, setQuickTaskTitle] = useState('');

  const todayTasks = dailyTasks.filter(
    (t) => t.date === dailyViewDate && !t.completed,
  );

  const firstName = user?.name?.split(' ')[0] || 'there';

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(SESSION_KEY, 'true');
    } catch {
      // localStorage unavailable — the ritual will reappear next mount,
      // which is acceptable degradation.
    }
    onDismiss();
  };

  const handleAdvance = (taskId: string | null, quickTitle?: string) => {
    if (taskId) {
      setPickedTaskId(taskId);
    } else if (quickTitle && quickTitle.trim()) {
      // Quick-add path: create a 1-pomodoro task for today, then pick
      // it. addDailyTaskForDate is idempotent on title, so re-clicks
      // don't double-add.
      const trimmed = quickTitle.trim().slice(0, 80);
      addDailyTaskForDate(trimmed, dailyViewDate, 1);
      // Find the just-created task by title — addDailyTaskForDate
      // appends to the end of dailyTasks, but the in-memory array
      // hasn't updated yet at this microtask. Defer.
      requestAnimationFrame(() => {
        const fresh = useStore
          .getState()
          .dailyTasks.find((t) => t.title === trimmed && t.date === dailyViewDate);
        if (fresh) setPickedTaskId(fresh.id);
      });
    }
    setStep('frame');
  };

  const handleLaunch = () => {
    setStep('launching');
    if (pickedTaskId) {
      setActiveDailyTask(pickedTaskId);
    }
    setDashboardMode('daily');
    // Mark ritual seen BEFORE the timer starts so a refresh-mid-session
    // doesn't loop the user back here.
    try {
      window.localStorage.setItem(SESSION_KEY, 'true');
    } catch { /* ignore */ }
    startTimer();
    setView('focus');
    onLaunch();
  };

  return (
    <AnimatePresence>
      <motion.div
        key="ritual-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-md"
        onClick={handleDismiss}
      />
      <motion.div
        key="ritual-panel"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -16 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(94vw,560px)] z-[91] rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#11161E] to-[#0B0F14] shadow-2xl shadow-black/70 p-7 sm:p-9 overflow-hidden"
      >
        {/* Glow accent — sits behind content, blurred. */}
        <div
          aria-hidden="true"
          className="absolute -top-32 -right-32 w-64 h-64 rounded-full bg-cyan-500/[0.10] blur-3xl pointer-events-none"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-32 -left-32 w-64 h-64 rounded-full bg-purple-500/[0.08] blur-3xl pointer-events-none"
        />

        <div className="relative">
          {/* Step indicator */}
          <div className="flex items-center gap-1.5 mb-6">
            <Dot active={step === 'choose'} />
            <Dot active={step === 'frame'} />
            <Dot active={step === 'launching'} />
          </div>

          {step === 'choose' && (
            <ChooseStep
              firstName={firstName}
              tasks={todayTasks}
              quickTitle={quickTaskTitle}
              setQuickTitle={setQuickTaskTitle}
              onAdvance={handleAdvance}
              onSkip={handleDismiss}
            />
          )}

          {step === 'frame' && (
            <FrameStep
              firstName={firstName}
              onBack={() => setStep('choose')}
              onLaunch={handleLaunch}
            />
          )}

          {step === 'launching' && (
            <LaunchingStep firstName={firstName} />
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function Dot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`h-1 rounded-full transition-all ${
        active ? 'w-8 bg-cyan-400' : 'w-3 bg-white/15'
      }`}
    />
  );
}

function ChooseStep({
  firstName,
  tasks,
  quickTitle,
  setQuickTitle,
  onAdvance,
  onSkip,
}: {
  firstName: string;
  tasks: { id: string; title: string }[];
  quickTitle: string;
  setQuickTitle: (s: string) => void;
  onAdvance: (taskId: string | null, quickTitle?: string) => void;
  onSkip: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 text-cyan-400/80 mb-2">
        <Sparkles className="w-4 h-4" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">
          Welcome, {firstName}
        </span>
      </div>
      <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2 leading-tight">
        Let&rsquo;s do one focus block right now.
      </h2>
      <p className="text-sm text-white/55 mb-6 leading-relaxed">
        You&rsquo;ll feel the difference in 25 minutes. Pick something small to
        start with — momentum first, complexity later.
      </p>

      {tasks.length > 0 ? (
        <div className="space-y-2 mb-4">
          <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">
            From your plan today
          </p>
          {tasks.slice(0, 3).map((t) => (
            <button
              key={t.id}
              onClick={() => onAdvance(t.id)}
              className="w-full text-left px-4 py-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-cyan-500/[0.06] hover:border-cyan-400/30 transition-all group"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-white/85 truncate">{t.title}</span>
                <ArrowRight className="w-4 h-4 text-cyan-400/0 group-hover:text-cyan-400 transition-colors shrink-0" />
              </div>
            </button>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">
          Or, pick something on the fly
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder='e.g. "Outline the proposal"'
            className="flex-1 px-4 py-3 rounded-xl border border-white/[0.08] bg-white/[0.02] text-sm text-white placeholder:text-white/25 outline-none focus:border-cyan-400/40"
            maxLength={80}
            autoFocus={tasks.length === 0}
          />
          <Button
            onClick={() => onAdvance(null, quickTitle)}
            disabled={!quickTitle.trim()}
            className="bg-cyan-500 hover:bg-cyan-400 text-[#0B0F14] disabled:opacity-30 px-5"
          >
            Pick
          </Button>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={onSkip}
          className="text-xs text-white/30 hover:text-white/55 transition-colors"
        >
          I&rsquo;ll explore first
        </button>
        <span className="text-[10px] text-white/20">
          You can always change tasks mid-session
        </span>
      </div>
    </>
  );
}

function FrameStep({
  firstName,
  onBack,
  onLaunch,
}: {
  firstName: string;
  onBack: () => void;
  onLaunch: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 text-purple-400/80 mb-2">
        <Wind className="w-4 h-4" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">
          Two beats of context
        </span>
      </div>
      <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-4 leading-tight">
        25 minutes. Phone face-down.
      </h2>

      <div className="space-y-3 mb-6">
        <FrameCard
          icon={<Timer className="w-4 h-4 text-cyan-400" />}
          title="One thing only"
          body="If your mind drifts to a different task, jot it on a sticky note and come back. Multitasking is the hardest possible failure mode."
        />
        <FrameCard
          icon={<Coffee className="w-4 h-4 text-amber-400" />}
          title="Even 5 minutes counts"
          body="A bad session is still infinitely better than skipping. Your future self will thank you."
        />
        <FrameCard
          icon={<Zap className="w-4 h-4 text-emerald-400" />}
          title="Done > perfect"
          body="The goal is to start. Not to be brilliant. Not to finish. Just start, and keep going for as long as the timer runs."
        />
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          ← Pick a different task
        </button>
        <Button
          onClick={onLaunch}
          className="bg-cyan-500 hover:bg-cyan-400 text-[#0B0F14] font-semibold px-7 py-3"
        >
          Start your first focus →
        </Button>
      </div>

      <p className="mt-4 text-[10px] text-center text-white/25">
        {firstName}, this is the moment most people skip. You&rsquo;ve got this.
      </p>
    </>
  );
}

function FrameCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-white/[0.05] bg-white/[0.02]">
      <span className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold text-white/85 mb-0.5">{title}</p>
        <p className="text-xs text-white/50 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function LaunchingStep({ firstName }: { firstName: string }) {
  return (
    <div className="text-center py-12">
      <motion.div
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        className="w-16 h-16 rounded-2xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center mx-auto mb-5"
      >
        <Sparkles className="w-7 h-7 text-cyan-400" />
      </motion.div>
      <p className="text-lg font-bold text-white tracking-tight">
        Go, {firstName}.
      </p>
      <p className="text-sm text-white/45 mt-1">Opening focus mode…</p>
    </div>
  );
}

/**
 * Should-show predicate. Caller (Dashboard) gates the modal on this.
 * The check happens client-side post-init so we don't render the
 * ritual during the BootLoader phase.
 *
 * Conditions for showing:
 *   - User exists and onboarding completed
 *   - User has done zero focus sessions ever (storage.getCompletedSessions('').length === 0)
 *   - Hasn't dismissed in this localStorage frame
 *
 * The session-completed check uses storage rather than cloud because
 * cloud calls during init add latency to the activation moment. False
 * negatives (cloud has sessions, local doesn't) only happen across
 * device boundaries — those users get the ritual once on the new
 * device, which is acceptable.
 */
export function shouldShowFirstSessionRitual(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const seen = window.localStorage.getItem(SESSION_KEY);
    if (seen === 'true') return false;
    const sessionCount = storage.getCompletedSessions('').length;
    return sessionCount === 0;
  } catch {
    return false;
  }
}
