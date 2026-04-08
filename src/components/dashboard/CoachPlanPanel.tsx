'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { Sparkles, Plus, X, Loader2 } from 'lucide-react';
import { TASK_TAGS, type TaskTagId } from '@/types';

export function CoachPlanPanel() {
  const coachPlan = useStore(s => s.coachPlan);
  const coachPlanLoading = useStore(s => s.coachPlanLoading);
  const dismissCoachPlan = useStore(s => s.dismissCoachPlan);
  const addDailyTaskForDate = useStore(s => s.addDailyTaskForDate);
  const dailyViewDate = useStore(s => s.dailyViewDate);
  const addToast = useStore(s => s.addToast);

  const [addedTasks, setAddedTasks] = React.useState<Set<number>>(new Set());

  // Reset when plan changes
  React.useEffect(() => {
    setAddedTasks(new Set());
  }, [coachPlan]);

  const handleAddTask = (index: number, task: { title: string; pomodoros: number; tag: string }) => {
    const validTag = TASK_TAGS.find(t => t.id === task.tag);
    addDailyTaskForDate(task.title, dailyViewDate, task.pomodoros, false, validTag?.id as TaskTagId | undefined);
    setAddedTasks(prev => new Set([...prev, index]));
    addToast(`Added "${task.title}"`, 'success');
  };

  const handleAddAll = () => {
    if (!coachPlan) return;
    coachPlan.suggestedTasks.forEach((task, i) => {
      if (!addedTasks.has(i)) {
        const validTag = TASK_TAGS.find(t => t.id === task.tag);
        addDailyTaskForDate(task.title, dailyViewDate, task.pomodoros, false, validTag?.id as TaskTagId | undefined);
      }
    });
    setAddedTasks(new Set(coachPlan.suggestedTasks.map((_, i) => i)));
    addToast('All tasks added!', 'success');
  };

  if (!coachPlan && !coachPlanLoading) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        className="overflow-hidden"
      >
        <div className="bg-gradient-to-br from-cyan-500/[0.06] to-blue-500/[0.04] border border-cyan-500/10 rounded-2xl p-4 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-cyan-500/10 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <span className="text-sm font-medium text-white/80">AI Coach</span>
            </div>
            {coachPlan && (
              <button
                onClick={dismissCoachPlan}
                className="text-white/20 hover:text-white/50 transition-colors p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Loading state */}
          {coachPlanLoading && (
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
              <span className="text-sm text-white/40">Analyzing your patterns...</span>
            </div>
          )}

          {/* Plan content */}
          {coachPlan && (
            <>
              {/* Greeting */}
              <p className="text-sm text-white/50">{coachPlan.greeting}</p>

              {/* Suggested tasks */}
              <div className="space-y-2">
                {coachPlan.suggestedTasks.map((task, i) => {
                  const added = addedTasks.has(i);
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className={`flex items-start justify-between gap-2 p-2.5 rounded-xl transition-colors ${
                        added
                          ? 'bg-green-500/[0.06] border border-green-500/10'
                          : 'bg-white/[0.03] border border-white/[0.05] hover:border-cyan-500/20'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${added ? 'text-green-400/70' : 'text-white/70'}`}>
                          {task.title}
                        </p>
                        <p className="text-xs text-white/25 mt-0.5">
                          {task.pomodoros} pomodoro{task.pomodoros !== 1 ? 's' : ''}
                          {task.tag && ` · ${task.tag}`}
                          {task.reason && ` — ${task.reason}`}
                        </p>
                      </div>
                      {!added ? (
                        <button
                          onClick={() => handleAddTask(i, task)}
                          className="shrink-0 w-7 h-7 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 flex items-center justify-center transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5 text-cyan-400" />
                        </button>
                      ) : (
                        <span className="text-xs text-green-400/60 shrink-0 py-1.5">Added</span>
                      )}
                    </motion.div>
                  );
                })}
              </div>

              {/* Summary + add all */}
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-white/25">
                  {coachPlan.totalPomodoros} pomodoros · ~{coachPlan.estimatedHours}h
                </p>
                {addedTasks.size < coachPlan.suggestedTasks.length && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-cyan-400/60 hover:text-cyan-400"
                    onClick={handleAddAll}
                  >
                    Add All
                  </Button>
                )}
              </div>

              {/* Insight */}
              {coachPlan.insight && (
                <p className="text-xs text-white/30 border-t border-white/[0.05] pt-3">
                  {coachPlan.insight}
                </p>
              )}
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
