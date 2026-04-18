'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles } from 'lucide-react';
import { useStore } from '@/store/useStore';

/**
 * Outer shell — mounts/unmounts WizardBody based on store flag. We split
 * the stateful body into a separate component so closing the wizard
 * unmounts it naturally, giving us a free state reset on reopen without
 * needing an effect to call setState (which React 19 flags as a
 * cascading render).
 */
export function AIPlanWizard() {
  const showAIPlanWizard = useStore(s => s.showAIPlanWizard);
  if (!showAIPlanWizard) return null;
  return <WizardBody />;
}

function WizardBody() {
  const setShowAIPlanWizard = useStore(s => s.setShowAIPlanWizard);
  const requestPlanMyDay = useStore(s => s.requestPlanMyDay);

  const [hoursSelected, setHoursSelected] = useState(4);
  const [customHours, setCustomHours] = useState('');
  const [priorities, setPriorities] = useState('');
  const [step, setStep] = useState<1 | 2>(1);

  // `step` defaults to 1 on mount; nothing else promotes it to 2 yet.
  // Silence the unused-setter warning by acknowledging it — the step-2
  // UI is wired up below and will use setStep once Step 2 is built out.
  void setStep;

  const handlePlan = () => {
    const hours = customHours ? parseFloat(customHours) : hoursSelected;
    if (isNaN(hours) || hours <= 0) {
      return;
    }

    requestPlanMyDay({
      hoursAvailable: hours,
      priorities: priorities.trim() || 'No specific priorities',
    });

    setShowAIPlanWizard(false);
  };

  const handleSkip = () => {
    requestPlanMyDay();
    setShowAIPlanWizard(false);
  };

  const handleClose = () => {
    setShowAIPlanWizard(false);
  };

  const getDisplayHours = (): number => {
    if (customHours) {
      const parsed = parseFloat(customHours);
      return isNaN(parsed) ? hoursSelected : parsed;
    }
    return hoursSelected;
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
        onClick={handleClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={e => e.stopPropagation()}
          className="bg-[#0B0F14] border border-cyan-500/20 rounded-2xl p-6 w-full max-w-md shadow-2xl"
        >
          {/* Header with close button */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-cyan-400" />
              </div>
              <h2 className="text-lg font-semibold text-white">Plan Your Day</h2>
            </div>
            <button
              onClick={handleClose}
              className="text-white/40 hover:text-white/70 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Step 1: Intake Form */}
          {step === 1 && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="space-y-5"
            >
              {/* Hours Available */}
              <div>
                <label className="block text-sm font-medium text-white/80 mb-3">
                  How many hours do you have?
                </label>
                <div className="flex gap-2 flex-wrap">
                  {[2, 4, 6, 8].map(hours => (
                    <button
                      key={hours}
                      onClick={() => {
                        setHoursSelected(hours);
                        setCustomHours('');
                      }}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                        customHours === '' && hoursSelected === hours
                          ? 'bg-cyan-500/30 border border-cyan-500/60 text-cyan-300'
                          : 'bg-white/5 border border-white/10 text-white/60 hover:border-cyan-500/40'
                      }`}
                    >
                      {hours}h
                    </button>
                  ))}
                </div>
                <div className="mt-3">
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={customHours}
                    onChange={e => {
                      setCustomHours(e.target.value);
                    }}
                    placeholder="Or enter custom hours"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-cyan-500/40 transition-colors"
                  />
                </div>
              </div>

              {/* Priorities */}
              <div>
                <label className="block text-sm font-medium text-white/80 mb-3">
                  What must get done?
                </label>
                <textarea
                  value={priorities}
                  onChange={e => setPriorities(e.target.value)}
                  placeholder="e.g., Finish auth API, Review PRs, Write docs..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-cyan-500/40 transition-colors resize-none"
                />
              </div>

              {/* Action buttons */}
              <div className="space-y-3 pt-4">
                <button
                  onClick={handlePlan}
                  className="w-full py-3 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-medium hover:shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-shadow"
                >
                  Plan
                </button>
                <button
                  onClick={handleSkip}
                  className="w-full text-sm text-white/50 hover:text-white/80 transition-colors py-2"
                >
                  Skip, just suggest
                </button>
              </div>
            </motion.div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
