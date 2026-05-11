'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { SelectGroup } from '@/components/ui/select-group';
import { useStore } from '@/store/useStore';
import { ArrowRight, ArrowLeft, Sparkles, X, MessageCircle, Check, ListChecks, Target } from 'lucide-react';
import type { BotPersona } from '@/types';
import {
  GOAL_TEMPLATES,
  deadlineForTemplate,
  type GoalTemplate,
} from '@/lib/goal-templates';

// 6 steps: goal → why → context → perception → bot persona → WhatsApp opt-in.
// WhatsApp stays LAST so users finish the value-defining flow first
// (goal + plan) before any opt-in ask. Persona sits right before the
// WhatsApp step because the persona IS the voice of those messages —
// users pick the voice, then choose to hear it.
const STEP_COUNT = 6;
const PERSONA_STEP = 4;
const WHATSAPP_STEP = 5;

// ── Bot persona definitions ──────────────────────────────────────
//
// Persona drives the voice of every WhatsApp message we send (welcome,
// nudges, weekly recaps). Four flavours; the `preview` line is what
// the user sees on the persona-pick step so they can audition the
// voice before committing.
//
// Declared at module-top so both StepBotPersona (which renders the
// tiles) and StepWhatsAppOptIn (which echoes the chosen label on the
// success card) can read from the same source of truth.
const PERSONA_LABEL: Record<BotPersona, string> = {
  friend: 'Friend',
  mentor: 'Mentor',
  boss: 'Boss',
  colleague: 'Colleague',
};

const PERSONAS: ReadonlyArray<{
  value: BotPersona;
  emoji: string;
  label: string;
  blurb: string;
  preview: string;
}> = [
  {
    value: 'friend',
    emoji: '🤝',
    label: 'Friend',
    blurb: 'Casual, hyped, occasionally roasts you',
    preview: '"Yo, you up? Two poms before noon, let\'s gooo 🚀"',
  },
  {
    value: 'mentor',
    emoji: '🌱',
    label: 'Mentor',
    blurb: 'Calm, growth-minded, asks great questions',
    preview: '"Morning. What\'s the smallest meaningful step today?"',
  },
  {
    value: 'boss',
    emoji: '🫡',
    label: 'Boss',
    blurb: 'Direct, results-driven, no fluff',
    preview: '"Stand-up. What shipped yesterday, what ships today?"',
  },
  {
    value: 'colleague',
    emoji: '👋',
    label: 'Colleague',
    blurb: 'Helpful peer, dry pragmatism, low ceremony',
    preview: '"Logging the queue. Top of the list — still that PR?"',
  },
];

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 100 : -100,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction > 0 ? -100 : 100,
    opacity: 0,
  }),
};

export function OnboardingFlow() {
  const {
    onboardingStep,
    onboardingData,
    setOnboardingStep,
    updateOnboardingData,
    completeOnboarding,
    user,
  } = useStore();

  const [direction, setDirection] = useState(1);
  const [goalError, setGoalError] = useState('');
  // ── Onboarding fork ─────────────────────────────────────────────
  // After the pivot to a task-list-first product, the very first thing a
  // new user sees is a fork: "Plan today" (drop straight into the Today
  // tab) vs "Set a long-term goal" (run the existing multi-step flow).
  // We render the fork picker until the user picks one of those paths
  // OR the user already has a goalTitle (e.g. resuming an in-progress
  // onboarding draft) — in which case we know they want the goal flow.
  const [forkChoice, setForkChoice] = useState<'goal' | null>(
    onboardingData.goalTitle ? 'goal' : null,
  );

  const step = onboardingStep;

  const goNext = useCallback(() => {
    if (step === 0) {
      const title = onboardingData.goalTitle?.trim() || '';
      if (title.length < 5) {
        setGoalError('Please describe your goal in at least 5 characters');
        return;
      }
      // Reject vague inputs
      const vague = ['something', 'stuff', 'things', 'idk', 'anything'];
      if (vague.some(v => title.toLowerCase() === v)) {
        setGoalError('Please be more specific about your goal');
        return;
      }
      setGoalError('');
    }
    if (step === 2) {
      if (!onboardingData.experienceLevel) {
        updateOnboardingData({ experienceLevel: 'intermediate' });
      }
      if (!onboardingData.consistencyLevel) {
        updateOnboardingData({ consistencyLevel: 'medium' });
      }
      if (!onboardingData.dailyAvailability) {
        updateOnboardingData({ dailyAvailability: 2 });
      }
    }
    if (step === PERSONA_STEP) {
      // Default to 'friend' so the WhatsApp step always has a persona
      // to send through, even if the user blew past with the empty
      // selection.
      if (!onboardingData.botPersona) {
        updateOnboardingData({ botPersona: 'friend' });
      }
    }
    setDirection(1);
    if (step < STEP_COUNT - 1) {
      setOnboardingStep(step + 1);
    } else {
      completeOnboarding();
    }
  }, [step, onboardingData, setOnboardingStep, updateOnboardingData, completeOnboarding]);

  const goBack = () => {
    setDirection(-1);
    setOnboardingStep(Math.max(0, step - 1));
  };

  /**
   * Quick-start: user picked an archetype on step 0. Pre-fill every
   * field the template covers and jump straight to the persona step
   * (4) — motivation/context/perception are redundant because the
   * template specifies them. Hitting Back from step 4 still walks
   * through each pre-filled step in case the user wants to tweak.
   */
  const handleTemplatePicked = useCallback((template: GoalTemplate) => {
    updateOnboardingData({
      templateId: template.id,
      goalTitle: template.goalTitle,
      motivation: template.motivation,
      experienceLevel: template.experienceLevel,
      dailyAvailability: template.dailyAvailability,
      consistencyLevel: template.consistencyLevel,
      userTimeEstimate: template.userTimeEstimate,
      deadline: deadlineForTemplate(template),
    });
    setGoalError('');
    setDirection(1);
    setOnboardingStep(PERSONA_STEP);
  }, [updateOnboardingData, setOnboardingStep]);

  // ── Fork picker render path ────────────────────────────────────
  // First impression for a brand-new user. Two cards: Plan today
  // (the new product hero) and Set a long-term goal (the original
  // flow). We early-return BEFORE the multi-step layout so the user
  // doesn&apos;t see a progress bar for a flow they haven&apos;t
  // committed to yet.
  if (forkChoice === null && step === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-lg relative">
          <button
            onClick={() => useStore.setState({ currentView: 'dashboard', onboardingStep: 0, onboardingData: {} })}
            className="absolute top-0 right-0 text-white/30 hover:text-white/60 transition-colors p-1"
            aria-label="Skip onboarding"
          >
            <X className="w-5 h-5" />
          </button>
          {user && (
            <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-white/40 text-sm mb-2"
            >
              Welcome, {user.name}
            </motion.p>
          )}
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-2xl sm:text-3xl font-semibold text-white mb-2 tracking-tight"
          >
            How do you want to start?
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-sm text-white/40 mb-8"
          >
            You can always switch later from the top of the dashboard.
          </motion.p>
          <div className="space-y-3">
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              onClick={() =>
                useStore.setState({
                  currentView: 'dashboard',
                  dashboardMode: 'daily',
                  onboardingStep: 0,
                  onboardingData: {},
                })
              }
              className="group w-full text-left p-5 rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/[0.06] to-blue-500/[0.03] hover:border-cyan-400/40 hover:from-cyan-500/[0.09] transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
                  <ListChecks className="w-5 h-5 text-cyan-300" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-base font-semibold text-white">Plan today&rsquo;s tasks</h2>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 font-medium">
                      Recommended
                    </span>
                  </div>
                  <p className="text-sm text-white/55 leading-relaxed">
                    Drop in three things you want to ship today. Tap any of them
                    to start a Pomodoro. The AI coach takes it from there.
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-white/30 group-hover:text-cyan-300 transition-colors mt-2" />
              </div>
            </motion.button>

            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              onClick={() => setForkChoice('goal')}
              className="group w-full text-left p-5 rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.03] transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center flex-shrink-0">
                  <Target className="w-5 h-5 text-white/55" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-white/85 mb-1">Set a long-term goal</h2>
                  <p className="text-sm text-white/45 leading-relaxed">
                    Finish your novel, the bar exam, your MVP. EffortOS sizes
                    the work and paces it across weeks.
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-white/25 group-hover:text-white/55 transition-colors mt-2" />
              </div>
            </motion.button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg relative">
        {/* Close button */}
        <button
          onClick={() => useStore.setState({ currentView: 'dashboard', onboardingStep: 0, onboardingData: {} })}
          className="absolute top-0 right-0 text-white/30 hover:text-white/60 transition-colors p-1"
          aria-label="Cancel"
        >
          <X className="w-5 h-5" />
        </button>

        {/*
          Progress bar — exposed as a single ARIA progressbar role so screen
          readers announce "Step N of M". Without this the dots were pure
          visual divs; assistive tech got no hint that the user was inside
          a multi-step flow at all.
        */}
        <div
          className="flex items-center gap-2 mb-8"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEP_COUNT}
          aria-valuenow={step + 1}
          aria-valuetext={`Step ${step + 1} of ${STEP_COUNT}`}
          aria-label="Onboarding progress"
        >
          {Array.from({ length: STEP_COUNT }).map((_, i) => (
            <div key={i} className="flex-1 flex items-center gap-2" aria-hidden="true">
              <div
                className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                  i <= step ? 'bg-cyan-500' : 'bg-white/10'
                }`}
              />
            </div>
          ))}
        </div>

        {/* Greeting */}
        {step === 0 && user && (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-white/40 text-sm mb-2"
          >
            Welcome, {user.name}
          </motion.p>
        )}

        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            {step === 0 && (
              <StepGoalInput
                value={onboardingData.goalTitle || ''}
                onChange={(v) => { updateOnboardingData({ goalTitle: v }); setGoalError(''); }}
                error={goalError}
                onTemplatePicked={handleTemplatePicked}
                activeTemplateId={onboardingData.templateId}
              />
            )}
            {step === 1 && (
              <StepWhyMotivation
                data={onboardingData}
                onChange={updateOnboardingData}
              />
            )}
            {step === 2 && (
              <StepContextCalibration
                data={onboardingData}
                onChange={updateOnboardingData}
              />
            )}
            {step === 3 && (
              <StepUserPerception
                data={onboardingData}
                onChange={updateOnboardingData}
              />
            )}
            {step === PERSONA_STEP && (
              <StepBotPersona
                value={onboardingData.botPersona}
                onChange={(p) => updateOnboardingData({ botPersona: p })}
              />
            )}
            {step === WHATSAPP_STEP && (
              <StepWhatsAppOptIn persona={onboardingData.botPersona ?? 'friend'} />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        {/* The WhatsApp step renders its own action bar inside the step
            because the verify flow has multiple internal states (input →
            otp → linked) that don't map cleanly onto a single Continue
            button. The shared nav below is hidden on that step. */}
        {step !== WHATSAPP_STEP && (
          <div className="flex items-center justify-between mt-8">
            {step > 0 ? (
              <Button variant="ghost" onClick={goBack} className="gap-2">
                <ArrowLeft className="w-4 h-4" />
                Back
              </Button>
            ) : (
              <div />
            )}
            <Button
              variant="glow"
              onClick={goNext}
              className="gap-2"
            >
              {step === STEP_COUNT - 2 ? (
                // Last "regular" step → users have given us everything
                // we need to estimate. Next click takes them to the
                // optional WhatsApp opt-in.
                <>
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// Step 1.5: Why — Motivation
function StepWhyMotivation({ data, onChange }: {
  data: Partial<import('@/types').OnboardingData>;
  onChange: (d: Partial<import('@/types').OnboardingData>) => void;
}) {
  const motivations = [
    { value: 'career', label: 'Career Growth', desc: 'Promotion, new job, or skill development' },
    { value: 'personal', label: 'Personal Project', desc: 'Building something I care about' },
    { value: 'learning', label: 'Learning', desc: 'Picking up a new skill or knowledge area' },
    { value: 'health', label: 'Health & Habits', desc: 'Building better routines' },
    { value: 'creative', label: 'Creative Work', desc: 'Art, writing, music, or design' },
    { value: 'accountability', label: 'Accountability', desc: "I know what to do, I just don't do it" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Why does this matter to you?</h2>
        <p className="text-white/40 text-sm">
          Understanding your motivation helps us keep you on track when things get tough.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {motivations.map(m => (
          <button
            key={m.value}
            onClick={() => onChange({ motivation: m.value })}
            className={`text-left p-3 rounded-xl border transition-all ${
              data.motivation === m.value
                ? 'border-cyan-500/30 bg-cyan-500/[0.06] text-white'
                : 'border-white/[0.06] bg-white/[0.02] text-white/50 hover:text-white/70 hover:bg-white/[0.04]'
            }`}
          >
            <p className="text-sm font-medium">{m.label}</p>
            <p className="text-[11px] text-white/30 mt-0.5">{m.desc}</p>
          </button>
        ))}
      </div>

      <div>
        <textarea
          value={data.motivationNote || ''}
          onChange={(e) => onChange({ motivationNote: e.target.value })}
          placeholder="Anything else you want to share? (optional)"
          className="w-full h-20 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/25 transition-all duration-200 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50 text-sm"
        />
      </div>
    </div>
  );
}

// Step 1: Goal Input — quick-start templates above, free-text fallback below.
function StepGoalInput({
  value,
  onChange,
  error,
  onTemplatePicked,
  activeTemplateId,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string;
  onTemplatePicked: (template: GoalTemplate) => void;
  activeTemplateId?: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">What do you want to accomplish?</h2>
        <p className="text-white/40 text-sm">
          Pick a quick-start, or describe your own. You can always tweak later.
        </p>
      </div>

      {/* Quick-start templates. Picking one auto-fills the goal +
          estimation inputs and jumps the user straight to the persona
          step. We render 2-up on sm+, 1-up on mobile so each card has
          breathing room. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {GOAL_TEMPLATES.map((t) => {
          const selected = activeTemplateId === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTemplatePicked(t)}
              className={`text-left p-3 rounded-xl border transition-all ${
                selected
                  ? 'border-cyan-500/40 bg-cyan-500/[0.08] text-white shadow-lg shadow-cyan-500/5'
                  : 'border-white/[0.06] bg-white/[0.02] text-white/70 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base leading-none">{t.emoji}</span>
                <span className="text-sm font-semibold">{t.label}</span>
              </div>
              <p className="text-[11px] text-white/40 leading-snug">{t.blurb}</p>
            </button>
          );
        })}
      </div>

      {/* Or-divider — small, low-contrast so it doesn't compete with
          the template grid for the user's attention. */}
      <div className="flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-white/[0.06]" />
        <span className="text-[11px] uppercase tracking-wider text-white/30">
          Or describe your own
        </span>
        <div className="h-px flex-1 bg-white/[0.06]" />
      </div>

      <div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g., Build a full-stack SaaS application with Next.js and deploy to production"
          className={`w-full h-28 rounded-xl border bg-white/5 px-4 py-3 text-white placeholder:text-white/25 transition-all duration-200 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50 text-sm leading-relaxed ${
            error ? 'border-red-500/50' : 'border-white/10 hover:border-white/20'
          }`}
        />
        {error && (
          <p className="text-xs text-red-400 mt-1.5">{error}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {['Learn Python for data science', 'Write a research paper', 'Build a portfolio website'].map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onChange(example)}
            className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/40 hover:text-white/70 hover:bg-white/10 transition-all"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}

// Step 2: Context Calibration
function StepContextCalibration({ data, onChange }: {
  data: Partial<import('@/types').OnboardingData>;
  onChange: (d: Partial<import('@/types').OnboardingData>) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Tell us about yourself</h2>
        <p className="text-white/40 text-sm">
          This helps calibrate your effort estimate.
        </p>
      </div>

      <SelectGroup
        label="Experience level with this type of work"
        options={[
          { value: 'beginner', label: 'Beginner', description: 'Just starting out' },
          { value: 'intermediate', label: 'Intermediate', description: 'Some experience' },
          { value: 'advanced', label: 'Advanced', description: 'Very experienced' },
        ]}
        value={data.experienceLevel || 'intermediate'}
        onChange={(v) => onChange({ experienceLevel: v as 'beginner' | 'intermediate' | 'advanced' })}
      />

      <div className="space-y-2">
        <label className="block text-sm font-medium text-white/70">
          Hours available per day
        </label>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="0.5"
            max="8"
            step="0.5"
            value={data.dailyAvailability || 2}
            onChange={(e) => onChange({ dailyAvailability: parseFloat(e.target.value) })}
            className="flex-1 accent-cyan-500 h-2 rounded-full appearance-none bg-white/10 cursor-pointer"
          />
          <span className="text-white font-mono text-sm min-w-[3rem] text-right">
            {data.dailyAvailability || 2}h
          </span>
        </div>
      </div>

      <SelectGroup
        label="How consistent can you be?"
        options={[
          { value: 'low', label: 'Flexible', description: '1-3 days/week' },
          { value: 'medium', label: 'Regular', description: '4-5 days/week' },
          { value: 'high', label: 'Daily', description: '6-7 days/week' },
        ]}
        value={data.consistencyLevel || 'medium'}
        onChange={(v) => onChange({ consistencyLevel: v as 'low' | 'medium' | 'high' })}
      />

      <Input
        label="Deadline (optional)"
        type="date"
        value={data.deadline || ''}
        onChange={(e) => onChange({ deadline: e.target.value || undefined })}
        min={new Date().toISOString().split('T')[0]}
      />
    </div>
  );
}

// Step 3: User Perception
function StepUserPerception({ data, onChange }: {
  data: Partial<import('@/types').OnboardingData>;
  onChange: (d: Partial<import('@/types').OnboardingData>) => void;
}) {
  const [hours, setHours] = useState(data.userTimeEstimate?.toString() || '');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">One last thing</h2>
        <p className="text-white/40 text-sm">
          How long do <span className="text-white/70 font-medium">you</span> think this will take?
        </p>
      </div>

      <Card variant="glass" className="space-y-4">
        <p className="text-sm text-white/60">
          Your honest estimate helps us calibrate better. There&apos;s no wrong answer.
        </p>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Input
              label="Your estimate (in hours)"
              type="number"
              min="1"
              max="1000"
              placeholder="e.g., 40"
              value={hours}
              onChange={(e) => {
                setHours(e.target.value);
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val > 0) {
                  onChange({ userTimeEstimate: val });
                }
              }}
            />
          </div>
          <span className="text-white/30 text-sm pb-3">hours total</span>
        </div>

        {hours && parseFloat(hours) > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="text-xs text-white/40 pt-2 border-t border-white/5"
          >
            That&apos;s roughly {Math.round(parseFloat(hours) * 60 / 25)} Pomodoro sessions
            ({Math.round(parseFloat(hours) / (data.dailyAvailability || 2))} days at your pace)
          </motion.div>
        )}
      </Card>

      <div className="flex items-center gap-2 text-xs text-white/30">
        <Sparkles className="w-3 h-3 text-cyan-500/50" />
        <span>We&apos;ll compare your estimate with our model and find the sweet spot</span>
      </div>
    </div>
  );
}

// Step 5 (last): WhatsApp opt-in.
//
// Why this lives in onboarding and not just Settings: a user who connects
// during onboarding gets ~2-3× the engagement vs. a user who finds the
// setting later. The OTP-and-link flow works the same as in SettingsModal
// — we just wrap it in a flow that lets the user skip and still finish
// onboarding cleanly.
//
// `persona` is captured in the previous step and passed through to the
// confirm endpoint so the welcome WhatsApp message arrives in the voice
// the user picked. If a user re-runs onboarding for some reason, the
// last persona wins.
//
// Lifecycle:
//   - 'input' state: enter phone number, request OTP.
//   - 'verify' state: enter the 6-digit code we sent.
//   - 'linked' state: success screen with "Finish" CTA.
//   - "Skip for now" link is always visible and just calls
//     completeOnboarding(), which generates the plan and routes to the
//     dashboard. Skipping does NOT block the user from linking later
//     from Settings.
function StepWhatsAppOptIn({ persona }: { persona: BotPersona }) {
  const completeOnboarding = useStore(s => s.completeOnboarding);
  const [phone, setPhone] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [step, setStep] = React.useState<'input' | 'verify' | 'linked'>('input');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  async function handleSendOTP() {
    const cleaned = phone.replace(/\s/g, '');
    if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) {
      setError('Enter a valid number with country code (e.g. +919876543210)');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/whatsapp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', phone: cleaned }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to send code');
        return;
      }
      setStep('verify');
    } catch {
      setError('Something went wrong. Try again?');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOTP() {
    if (otp.length !== 6) {
      setError('Enter the 6-digit code we sent');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const cleaned = phone.replace(/\s/g, '');
      const res = await fetch('/api/whatsapp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `persona` is included so the welcome message uses the voice
        // the user just picked. The endpoint also persists it on the
        // profile, so subsequent coach messages inherit the same tone.
        body: JSON.stringify({ action: 'confirm', phone: cleaned, code: otp, persona }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Verification failed');
        return;
      }
      // Mirror Supabase state into the local store so the rest of the app
      // sees the user as linked immediately (without waiting for a
      // refetch). The verify endpoint already handed the welcome message
      // off to WhatsApp at this point. We also mirror the persona so
      // any UI that reads it (Settings, coach previews) is consistent.
      const currentUser = useStore.getState().user;
      if (currentUser) {
        useStore.setState({
          user: {
            ...currentUser,
            phone_number: cleaned,
            whatsapp_linked: true,
            bot_persona: persona,
          },
        });
      }
      setStep('linked');
    } catch {
      setError('Something went wrong. Try again?');
    } finally {
      setLoading(false);
    }
  }

  const finish = () => completeOnboarding();

  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 mb-3">
          <MessageCircle className="w-5 h-5 text-emerald-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">
          Get coached over WhatsApp
        </h2>
        <p className="text-white/40 text-sm">
          Add tasks, mark them done, and get gentle nudges — all without opening the app. Optional, and you can always set it up later from Settings.
        </p>
      </div>

      {step === 'input' && (
        <Card variant="glass" className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-white/70">
              Your WhatsApp number
            </label>
            <Input
              type="tel"
              placeholder="+919876543210"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setError(''); }}
              autoComplete="tel"
              inputMode="tel"
            />
            <p className="text-[11px] text-white/30">
              Use E.164 format with the country code. We&apos;ll send a 6-digit code to verify.
            </p>
            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={finish}
              className="text-sm text-white/40 hover:text-white/60 transition-colors"
            >
              Skip for now
            </button>
            <Button
              variant="glow"
              onClick={handleSendOTP}
              disabled={loading || !phone}
              className="gap-2"
            >
              {loading ? 'Sending...' : 'Send code'}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </Card>
      )}

      {step === 'verify' && (
        <Card variant="glass" className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-white/60">
              We sent a 6-digit code to <span className="text-white font-medium">{phone}</span>.
            </p>
            <Input
              type="text"
              placeholder="123456"
              value={otp}
              onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }}
              maxLength={6}
              inputMode="numeric"
              autoFocus
              className="text-center tracking-[0.4em] text-lg"
            />
            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => { setStep('input'); setOtp(''); setError(''); }}
              className="text-sm text-white/40 hover:text-white/60 transition-colors"
            >
              ← Wrong number?
            </button>
            <Button
              variant="glow"
              onClick={handleVerifyOTP}
              disabled={loading || otp.length !== 6}
              className="gap-2"
            >
              {loading ? 'Verifying...' : 'Verify & finish'}
              <Sparkles className="w-4 h-4" />
            </Button>
          </div>
        </Card>
      )}

      {step === 'linked' && (
        <Card variant="glass" className="space-y-4 text-center py-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 mx-auto">
            <Check className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">All set</h3>
            <p className="text-sm text-white/50 mt-1">
              Check WhatsApp — I just sent you a welcome message in <span className="text-white/70">{PERSONA_LABEL[persona]}</span> mode.
            </p>
          </div>
          <Button
            variant="glow"
            onClick={finish}
            className="gap-2 mx-auto"
          >
            Generate my plan
            <Sparkles className="w-4 h-4" />
          </Button>
        </Card>
      )}
    </div>
  );
}

// ── Step 4: Bot persona ──────────────────────────────────────────
// Tile picker over PERSONAS (defined at module-top). Default is
// 'friend' — applied automatically in goNext() if the user advances
// without choosing.
function StepBotPersona({
  value,
  onChange,
}: {
  value: BotPersona | undefined;
  onChange: (p: BotPersona) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 mb-3">
          <Sparkles className="w-5 h-5 text-cyan-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Pick your bot&apos;s vibe</h2>
        <p className="text-white/40 text-sm">
          This sets the tone for every WhatsApp message — the welcome, the nudges,
          the weekly recaps. You can change it any time in Settings.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {PERSONAS.map((p) => {
          const selected = value === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onChange(p.value)}
              className={`text-left p-3 rounded-xl border transition-all ${
                selected
                  ? 'border-cyan-500/40 bg-cyan-500/[0.08] text-white shadow-lg shadow-cyan-500/5'
                  : 'border-white/[0.06] bg-white/[0.02] text-white/60 hover:text-white/80 hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base leading-none">{p.emoji}</span>
                <span className="text-sm font-semibold">{p.label}</span>
              </div>
              <p className="text-[11px] text-white/40 leading-snug">{p.blurb}</p>
              <p className="text-[11px] text-white/35 italic mt-2 leading-snug">
                {p.preview}
              </p>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-white/25">
        Default: Friend. Tap any tile to change.
      </p>
    </div>
  );
}
