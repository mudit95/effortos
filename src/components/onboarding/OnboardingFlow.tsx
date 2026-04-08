'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { SelectGroup } from '@/components/ui/select-group';
import { useStore } from '@/store/useStore';
import { ArrowRight, ArrowLeft, Target, Brain, Clock, Sparkles, Heart } from 'lucide-react';

const STEP_COUNT = 4;

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

  const stepIcons = [
    <Target key="target" className="w-5 h-5" />,
    <Heart key="heart" className="w-5 h-5" />,
    <Brain key="brain" className="w-5 h-5" />,
    <Clock key="clock" className="w-5 h-5" />,
  ];

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {Array.from({ length: STEP_COUNT }).map((_, i) => (
            <div key={i} className="flex-1 flex items-center gap-2">
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
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
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
            {step === STEP_COUNT - 1 ? (
              <>
                Generate Plan
                <Sparkles className="w-4 h-4" />
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
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

// Step 1: Goal Input
function StepGoalInput({ value, onChange, error }: {
  value: string;
  onChange: (v: string) => void;
  error: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">What do you want to accomplish?</h2>
        <p className="text-white/40 text-sm">
          Be specific. &ldquo;Learn React&rdquo; is better than &ldquo;learn stuff.&rdquo;
        </p>
      </div>
      <div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g., Build a full-stack SaaS application with Next.js and deploy to production"
          className={`w-full h-32 rounded-xl border bg-white/5 px-4 py-3 text-white placeholder:text-white/25 transition-all duration-200 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50 text-sm leading-relaxed ${
            error ? 'border-red-500/50' : 'border-white/10 hover:border-white/20'
          }`}
          autoFocus
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
        <span>We&apos;ll compare your estimate with our AI analysis and find the sweet spot</span>
      </div>
    </div>
  );
}
