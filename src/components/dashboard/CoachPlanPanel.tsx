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

  const handleAddTask = (index: number, task: { title: string; pomodoros: number; tag: string; goal_id?: string; isGoalWork?: boolean }) => {
    const validTag = TASK_TAGS.find(t => t.id === task.tag);
    addDailyTaskForDate(task.title, dailyViewDate, task.pomodoros, false, validTag?.id as TaskTagId | undefined, task.goal_id);
    setAddedTasks(prev => new Set([...prev, index]));
    addToast(`Added "${task.title}"`, 'success');
  };

  const handleAddAll = () => {
    if (!coachPlan) return;
    coachPlan.suggestedTasks.forEach((task, i) => {
      if (!addedTasks.has(i)) {
        const validTag = TASK_TAGS.find(t => t.id === task.tag);
        addDailyTaskForDate(task.title, dailyViewDate, task.pomodoros, false, validTag?.id as TaskTagId | undefined, task.goal_id);
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

              {/* Deadline Warnings */}
              {coachPlan.deadlineWarnings && coachPlan.deadlineWarnings.length > 0 && (
                <div className="space-y-2">
                  {coachPlan.deadlineWarnings.map((warning, i) => (
                    <motion.div
                      key={`warning-${i}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="p-3 rounded-lg bg-amber-500/[0.08] border border-amber-500/20"
                    >
                      <p className="text-xs text-amber-300/80">{warning}</p>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Suggested tasks - grouped by goal work */}
              {(() => {
                const mustDoTasks = coachPlan.suggestedTasks.filter(t => !t.isGoalWork);
                const goalWorkTasks = coachPlan.suggestedTasks.filter(t => t.isGoalWork);

                const renderTaskList = (tasks: typeof coachPlan.suggestedTasks, groupLabel?: string) => (
                  <div className="space-y-2">
                    {groupLabel && (
                      <p className="text-xs font-medium text-white/50 px-1">{groupLabel}</p>
                    )}
                    {tasks.map((task, origIndex) => {
                      const i = coachPlan.suggestedTasks.indexOf(task);
                      const added = addedTasks.has(i);
                      return (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: origIndex * 0.05 }}
                          className={`flex items-start justify-between gap-2 p-2.5 rounded-xl transition-colors ${
                            task.isGoalWork ? 'border-l-2 border-l-violet-500/60' : ''
                          } ${
                            added
                              ? 'bg-green-500/[0.06] border border-green-500/10'
                              : 'bg-white/[0.03] border border-white/[0.05] hover:border-cyan-500/20'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className={`text-sm font-medium ${added ? 'text-green-400/70' : 'text-white/70'}`}>
                                {task.title}
                              </p>
                              {task.isGoalWork && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-violet-500/10 text-violet-400/70 border border-violet-500/20">
                                  🎯 Goal
                                </span>
                              )}
                            </div>
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
                );

                return (
                  <div className="space-y-4">
                    {mustDoTasks.length > 0 && renderTaskList(mustDoTasks, 'Must Do')}
                    {goalWorkTasks.length > 0 && renderTaskList(goalWorkTasks, 'Goal Work')}
                  </div>
                );
              })()}

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
