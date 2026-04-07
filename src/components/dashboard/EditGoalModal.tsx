'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStore } from '@/store/useStore';
import { X } from 'lucide-react';

export function EditGoalModal() {
  const showEditGoal = useStore(s => s.showEditGoal);
  const setShowEditGoal = useStore(s => s.setShowEditGoal);
  const activeGoal = useStore(s => s.activeGoal);
  const updateGoalDetails = useStore(s => s.updateGoalDetails);
  const pauseGoal = useStore(s => s.pauseGoal);

  const [title, setTitle] = useState(activeGoal?.title || '');
  const [description, setDescription] = useState(activeGoal?.description || '');

  if (!activeGoal) return null;

  // Sync state when modal opens
  React.useEffect(() => {
    if (showEditGoal && activeGoal) {
      setTitle(activeGoal.title);
      setDescription(activeGoal.description || '');
    }
  }, [showEditGoal, activeGoal]);

  return (
    <AnimatePresence>
      {showEditGoal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="w-full max-w-sm bg-[#131820] border border-white/10 rounded-2xl p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Edit Goal</h3>
              <button
                onClick={() => setShowEditGoal(false)}
                className="text-white/30 hover:text-white/60 transition-colors p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 mb-6">
              <Input
                label="Goal title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1.5">
                  Description (optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add more context..."
                  className="w-full h-20 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/25 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Button
                variant="glow"
                className="w-full"
                disabled={!title.trim() || title.trim().length < 5}
                onClick={() => updateGoalDetails(activeGoal.id, title.trim(), description.trim() || undefined)}
              >
                Save Changes
              </Button>
              <Button
                variant="outline"
                className="w-full text-yellow-400 border-yellow-400/20 hover:bg-yellow-400/5"
                onClick={() => {
                  pauseGoal(activeGoal.id);
                  setShowEditGoal(false);
                }}
              >
                Pause Goal
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
