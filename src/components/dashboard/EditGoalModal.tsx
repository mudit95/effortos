'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStore } from '@/store/useStore';
import { X, Trash2, AlertTriangle } from 'lucide-react';
import * as storage from '@/lib/storage';

export function EditGoalModal() {
  const showEditGoal = useStore(s => s.showEditGoal);
  const setShowEditGoal = useStore(s => s.setShowEditGoal);
  const activeGoal = useStore(s => s.activeGoal);
  const updateGoalDetails = useStore(s => s.updateGoalDetails);
  const pauseGoal = useStore(s => s.pauseGoal);
  const addToast = useStore(s => s.addToast);

  const [title, setTitle] = useState(activeGoal?.title || '');
  const [description, setDescription] = useState(activeGoal?.description || '');
  const [showPauseConfirm, setShowPauseConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (!activeGoal) return null;

  // Sync state when modal opens
  React.useEffect(() => {
    if (showEditGoal && activeGoal) {
      setTitle(activeGoal.title);
      setDescription(activeGoal.description || '');
      setShowPauseConfirm(false);
      setShowDeleteConfirm(false);
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
                disabled={!title.trim() || title.trim().length < 3}
                onClick={() => {
                  updateGoalDetails(activeGoal.id, title.trim(), description.trim() || undefined);
                  addToast('Goal updated!', 'success');
                }}
              >
                Save Changes
              </Button>

              {/* Pause with confirmation */}
              {!showPauseConfirm ? (
                <Button
                  variant="outline"
                  className="w-full text-yellow-400 border-yellow-400/20 hover:bg-yellow-400/5"
                  onClick={() => setShowPauseConfirm(true)}
                >
                  Pause Goal
                </Button>
              ) : (
                <div className="p-3 rounded-xl border border-yellow-400/20 bg-yellow-400/5 space-y-2">
                  <p className="text-xs text-yellow-400/70 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3" />
                    Your progress is saved. You can resume anytime.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="flex-1 text-xs" onClick={() => setShowPauseConfirm(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs text-yellow-400 border-yellow-400/20"
                      onClick={() => {
                        pauseGoal(activeGoal.id);
                        setShowEditGoal(false);
                        addToast('Goal paused. Resume it anytime from your goal list.', 'info');
                      }}
                    >
                      Yes, Pause
                    </Button>
                  </div>
                </div>
              )}

              {/* Delete with confirmation */}
              {!showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-red-400/40 hover:text-red-400 py-2 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete goal
                </button>
              ) : (
                <div className="p-3 rounded-xl border border-red-400/20 bg-red-400/5 space-y-2">
                  <p className="text-xs text-red-400/70 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3" />
                    This will remove the goal and all its data. This can&apos;t be undone.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="flex-1 text-xs" onClick={() => setShowDeleteConfirm(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs text-red-400 border-red-400/20 hover:bg-red-400/10"
                      onClick={() => {
                        storage.updateGoal(activeGoal.id, { status: 'abandoned' });
                        useStore.setState({ goals: storage.getGoals(), activeGoal: null, showEditGoal: false });
                        addToast('Goal removed', 'info');
                      }}
                    >
                      Yes, Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
