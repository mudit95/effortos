'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { X, ChevronDown, ChevronUp, Minus } from 'lucide-react';

export function FeedbackModal() {
  const showFeedback = useStore(s => s.showFeedback);
  const submitFeedback = useStore(s => s.submitFeedback);
  const dismissFeedback = useStore(s => s.dismissFeedback);
  const activeGoal = useStore(s => s.activeGoal);
  const [selected, setSelected] = useState<number | null>(null);

  const remaining = activeGoal
    ? activeGoal.estimated_sessions_current - activeGoal.sessions_completed
    : 0;

  const options = [
    { value: -2, label: 'Way easier than expected', description: "I'll be done much sooner", icon: <ChevronDown className="w-5 h-5" /> },
    { value: -1, label: 'Slightly easier', description: 'A session or two less than estimated', icon: <ChevronDown className="w-4 h-4" /> },
    { value: 0, label: 'Right on track', description: 'The estimate feels spot on', icon: <Minus className="w-4 h-4" /> },
    { value: 1, label: 'Slightly harder', description: 'Might need a couple more sessions', icon: <ChevronUp className="w-4 h-4" /> },
    { value: 2, label: 'Much harder than expected', description: "This is going to take a while longer", icon: <ChevronUp className="w-5 h-5" /> },
  ];

  return (
    <AnimatePresence>
      {showFeedback && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
            className="w-full max-w-sm bg-[#131820] border border-white/10 rounded-2xl p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-lg font-semibold text-white">Nice work! Quick check-in</h3>
              <button
                onClick={dismissFeedback}
                className="text-white/30 hover:text-white/60 transition-colors p-1"
                aria-label="Close feedback"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Context */}
            {activeGoal && (
              <p className="text-sm text-cyan-400/60 mb-1">
                {activeGoal.sessions_completed} sessions done — you&apos;re making real progress
              </p>
            )}

            <p className="text-sm text-white/40 mb-5">
              We think you have about {remaining} sessions left. How does that feel?
              <span className="block text-xs text-white/20 mt-1">Your answer helps us give you better estimates over time.</span>
            </p>

            <div className="space-y-2 mb-6">
              {options.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setSelected(option.value)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all duration-200 border ${
                    selected === option.value
                      ? 'bg-cyan-500/10 border-cyan-500/30 text-white'
                      : 'bg-white/[0.02] border-white/[0.04] text-white/60 hover:bg-white/[0.05]'
                  }`}
                >
                  <span className={selected === option.value ? 'text-cyan-400' : 'text-white/30'}>
                    {option.icon}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{option.label}</p>
                    <p className="text-xs text-white/30">{option.description}</p>
                  </div>
                </button>
              ))}
            </div>

            <Button
              variant="glow"
              className="w-full"
              disabled={selected === null}
              onClick={() => {
                if (selected !== null) {
                  submitFeedback(selected);
                  setSelected(null);
                }
              }}
            >
              Submit Feedback
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
