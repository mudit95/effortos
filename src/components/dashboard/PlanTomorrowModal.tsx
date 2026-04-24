'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import {
  X, ChevronRight, Plus, Trash2, ArrowRight,
  CheckCircle2, Circle, Moon, Sun,
} from 'lucide-react';
import { TASK_TAGS, type TaskTagId } from '@/types';

/**
 * "Plan Tomorrow" modal — an end-of-day ritual that lets users:
 *
 *   1. See today's unfinished tasks
 *   2. Toggle which ones carry forward to tomorrow
 *   3. Add new tasks for tomorrow
 *   4. Confirm and save
 *
 * The modal creates tomorrow's tasks via addDailyTaskForDate.
 * Tasks that are carried forward get a `scheduled_from` marker
 * so the UI can show "carried from Apr 22" if desired.
 */

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function getTomorrowKey(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

interface CarryTask {
  id: string;
  title: string;
  tag?: TaskTagId;
  pomodoros_target: number;
  carry: boolean;
}

interface NewTask {
  id: string;
  title: string;
  tag?: TaskTagId;
  pomodoros: number;
}

export function PlanTomorrowModal() {
  const showPlanTomorrow = useStore(s => s.showPlanTomorrow);
  const setShowPlanTomorrow = useStore(s => s.setShowPlanTomorrow);
  const dailyTasks = useStore(s => s.dailyTasks);
  const addDailyTaskForDate = useStore(s => s.addDailyTaskForDate);
  const addToast = useStore(s => s.addToast);

  const [carryTasks, setCarryTasks] = useState<CarryTask[]>([]);
  const [newTasks, setNewTasks] = useState<NewTask[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newTag, setNewTag] = useState<TaskTagId | undefined>();
  const [newPomodoros, setNewPomodoros] = useState(1);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<'review' | 'add' | 'confirm'>('review');

  // Initialize carry tasks from today's incomplete tasks
  useEffect(() => {
    if (!showPlanTomorrow) return;
    const today = getTodayKey();
    const incomplete = dailyTasks.filter(
      t => !t.completed && t.date === today
    );
    setCarryTasks(
      incomplete.map(t => ({
        id: t.id,
        title: t.title,
        tag: t.tag,
        pomodoros_target: t.pomodoros_target,
        carry: true, // default: carry everything forward
      }))
    );
    setNewTasks([]);
    setNewTitle('');
    setStep('review');
  }, [showPlanTomorrow, dailyTasks]);

  const toggleCarry = (id: string) => {
    setCarryTasks(prev =>
      prev.map(t => (t.id === id ? { ...t, carry: !t.carry } : t))
    );
  };

  const addNewTask = () => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setNewTasks(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        title: trimmed,
        tag: newTag,
        pomodoros: newPomodoros,
      },
    ]);
    setNewTitle('');
    setNewTag(undefined);
    setNewPomodoros(1);
  };

  const removeNewTask = (id: string) => {
    setNewTasks(prev => prev.filter(t => t.id !== id));
  };

  const totalTomorrow = carryTasks.filter(t => t.carry).length + newTasks.length;
  const totalPomodoros =
    carryTasks.filter(t => t.carry).reduce((s, t) => s + t.pomodoros_target, 0) +
    newTasks.reduce((s, t) => s + t.pomodoros, 0);

  const handleSave = async () => {
    setSaving(true);
    const tomorrow = getTomorrowKey();
    const today = getTodayKey();

    try {
      // 1. Create carried-forward tasks for tomorrow
      for (const task of carryTasks.filter(t => t.carry)) {
        await addDailyTaskForDate(
          task.title,
          tomorrow,
          task.pomodoros_target,
          false,
          task.tag,
          undefined
        );
      }

      // 2. Create new tasks for tomorrow
      for (const task of newTasks) {
        await addDailyTaskForDate(
          task.title,
          tomorrow,
          task.pomodoros,
          false,
          task.tag,
          undefined
        );
      }

      addToast(
        `Tomorrow planned: ${totalTomorrow} task${totalTomorrow !== 1 ? 's' : ''}, ${totalPomodoros} pomodoro${totalPomodoros !== 1 ? 's' : ''}`,
        'success'
      );
      setShowPlanTomorrow(false);
    } catch (err) {
      addToast('Failed to save tomorrow\'s plan', 'error');
      console.error('Plan tomorrow save error:', err);
    } finally {
      setSaving(false);
    }
  };

  if (!showPlanTomorrow) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={() => setShowPlanTomorrow(false)}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="bg-[#131820] border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Moon className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Plan Tomorrow</h2>
              <p className="text-[11px] text-white/40">End-of-day ritual</p>
            </div>
          </div>
          <button
            onClick={() => setShowPlanTomorrow(false)}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Step 1: Review carry-forward */}
          {carryTasks.length > 0 && (
            <div>
              <p className="text-xs text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
                <ArrowRight className="w-3 h-3" />
                Carry forward from today ({carryTasks.filter(t => t.carry).length}/{carryTasks.length})
              </p>
              <div className="space-y-1.5">
                {carryTasks.map(task => {
                  const tagInfo = task.tag
                    ? TASK_TAGS.find(t => t.id === task.tag)
                    : null;
                  return (
                    <button
                      key={task.id}
                      onClick={() => toggleCarry(task.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                        task.carry
                          ? 'bg-white/[0.04] border border-white/[0.08]'
                          : 'bg-transparent border border-transparent opacity-40'
                      }`}
                    >
                      {task.carry ? (
                        <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-white/20 shrink-0" />
                      )}
                      <span className="text-sm text-white/80 flex-1 truncate">
                        {task.title}
                      </span>
                      {tagInfo && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: tagInfo.color + '20',
                            color: tagInfo.color,
                          }}
                        >
                          {tagInfo.label}
                        </span>
                      )}
                      <span className="text-[10px] text-white/30">
                        {task.pomodoros_target}p
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {carryTasks.length === 0 && (
            <div className="text-center py-4">
              <Sun className="w-8 h-8 text-green-400/30 mx-auto mb-2" />
              <p className="text-sm text-white/40">All tasks completed today!</p>
              <p className="text-xs text-white/25 mt-0.5">Add fresh tasks for tomorrow below.</p>
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-white/[0.04]" />

          {/* Step 2: Add new tasks */}
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Plus className="w-3 h-3" />
              New tasks for tomorrow
            </p>

            {/* New tasks list */}
            {newTasks.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {newTasks.map(task => {
                  const tagInfo = task.tag
                    ? TASK_TAGS.find(t => t.id === task.tag)
                    : null;
                  return (
                    <div
                      key={task.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-purple-500/[0.04] border border-purple-500/10"
                    >
                      <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
                      <span className="text-sm text-white/80 flex-1 truncate">
                        {task.title}
                      </span>
                      {tagInfo && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: tagInfo.color + '20',
                            color: tagInfo.color,
                          }}
                        >
                          {tagInfo.label}
                        </span>
                      )}
                      <span className="text-[10px] text-white/30">
                        {task.pomodoros}p
                      </span>
                      <button
                        onClick={() => removeNewTask(task.id)}
                        className="text-white/20 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add task input */}
            <div className="flex gap-2">
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') addNewTask();
                }}
                placeholder="Add a task for tomorrow..."
                className="flex-1 px-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/20"
              />
              <select
                value={newPomodoros}
                onChange={e => setNewPomodoros(Number(e.target.value))}
                className="w-16 px-2 py-2 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-white/60 focus:outline-none"
              >
                {[1, 2, 3, 4].map(n => (
                  <option key={n} value={n}>
                    {n}p
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                size="icon"
                onClick={addNewTask}
                disabled={!newTitle.trim()}
                className="shrink-0"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {/* Quick tag selector */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {TASK_TAGS.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => setNewTag(newTag === tag.id ? undefined : tag.id)}
                  className={`text-[10px] px-2 py-1 rounded-full transition-colors ${
                    newTag === tag.id
                      ? 'ring-1 ring-white/20'
                      : 'opacity-50 hover:opacity-80'
                  }`}
                  style={{
                    backgroundColor: tag.color + '15',
                    color: tag.color,
                  }}
                >
                  {tag.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 pt-3 border-t border-white/[0.06]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-white/40">
              {totalTomorrow} task{totalTomorrow !== 1 ? 's' : ''} &middot; {totalPomodoros} pomodoro{totalPomodoros !== 1 ? 's' : ''} &middot; ~{Math.round(totalPomodoros * 25 / 60 * 10) / 10}h
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setShowPlanTomorrow(false)}
            >
              Cancel
            </Button>
            <Button
              variant="glow"
              className="flex-1 gap-2"
              onClick={handleSave}
              disabled={saving || totalTomorrow === 0}
            >
              {saving ? 'Saving...' : (
                <>
                  <Moon className="w-4 h-4" />
                  Plan Tomorrow
                </>
              )}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
