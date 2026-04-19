'use client';

/* ─────────────────────────────────────────────────────────────────────
 * TimeBoxView
 * --------------------------------------------------------------------
 * Alternate rendering of the Daily Grind task list as a 4-column grid:
 *
 *   [ Unscheduled ] [ Morning ] [ Afternoon ] [ Evening ]
 *
 * Tasks drag between columns. A drop writes `time_block` on the task
 * (null for Unscheduled) via the same updateDailyTaskDetails action
 * the rest of the app uses — so List view and Schedule view are just
 * two lenses over the same store state.
 *
 * Drag-and-drop uses the HTML5 native API, no external deps. The
 * column-level dragover handler toggles a highlight class by reading
 * from a local React state keyed on the block id; that keeps the drop
 * target clearly visible without triggering a layout thrash on every
 * dragover event.
 *
 * This is the "coarse" take — morning/afternoon/evening. Hourly slots
 * are on the roadmap and would live in a separate view (the SQL column
 * was sized so a companion integer hour column can be added later).
 * ──────────────────────────────────────────────────────────────────── */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarPlus,
  CheckCircle2,
  Circle,
  Play,
  Sun,
  Sunrise,
  Sunset,
  Trash2,
} from 'lucide-react';
import { DailyTask, Goal, TaskTagId, TIME_BLOCKS, TimeBlock, TASK_TAGS } from '@/types';

/** Same lookup DailyGrind uses — kept local to avoid cross-module coupling. */
function getTagInfo(tagId?: TaskTagId) {
  if (!tagId) return null;
  return TASK_TAGS.find(t => t.id === tagId);
}

/** Decorative icons per time block — purely visual context cue. */
function blockIcon(id: TimeBlock) {
  switch (id) {
    case 'morning':   return Sunrise;
    case 'afternoon': return Sun;
    case 'evening':   return Sunset;
  }
}

type DropTarget = TimeBlock | 'unscheduled' | null;

export interface TimeBoxViewProps {
  /** All tasks scoped to the currently-viewed date (both completed + pending). */
  tasks: DailyTask[];
  activeTaskId: string | null;
  isTimerActive: boolean;
  isToday: boolean;
  /** Whether "Roll to tomorrow" should be offered (today + past days). */
  canRollForward: boolean;
  goals: Goal[];
  onUpdateTask: (taskId: string, updates: Partial<DailyTask>) => void;
  onToggleComplete: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onStart: (taskId: string) => void;
  onExtend: (taskId: string) => void;
  onRollToTomorrow: (task: DailyTask) => void;
}

export function TimeBoxView({
  tasks,
  activeTaskId,
  isTimerActive,
  isToday,
  canRollForward,
  goals,
  onUpdateTask,
  onToggleComplete,
  onDelete,
  onStart,
  onExtend,
  onRollToTomorrow,
}: TimeBoxViewProps) {
  // Track which column is currently a drop target so we can light it up.
  // Kept in state (rather than a ref + imperative class swap) because React
  // re-renders here are cheap — only the column containers change.
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  // Track the dragged task's id so we can dim its card while airborne.
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Split tasks by block. Completed tasks still show up in their original
  // column (struck through) so the schedule reads as a daily record, not
  // just an aspirational plan.
  const unscheduled = tasks.filter(t => !t.time_block);
  const morning    = tasks.filter(t => t.time_block === 'morning');
  const afternoon  = tasks.filter(t => t.time_block === 'afternoon');
  const evening    = tasks.filter(t => t.time_block === 'evening');

  const handleDrop = (taskId: string, next: TimeBlock | null) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const current = task.time_block ?? null;
    if (current === next) return; // No-op drop onto same column.
    onUpdateTask(taskId, { time_block: next ?? undefined });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      <Column
        id="unscheduled"
        label="Unscheduled"
        hint="drag to schedule"
        tasks={unscheduled}
        isDropTarget={dropTarget === 'unscheduled'}
        draggingId={draggingId}
        onDragEnter={() => setDropTarget('unscheduled')}
        onDragLeave={() => setDropTarget(curr => curr === 'unscheduled' ? null : curr)}
        onDropTask={(taskId) => {
          setDropTarget(null);
          handleDrop(taskId, null);
        }}
        // Unscheduled column has no time icon — it's the default bucket.
        headerIcon={null}
        accent="slate"
        activeTaskId={activeTaskId}
        isTimerActive={isTimerActive}
        isToday={isToday}
        canRollForward={canRollForward}
        goals={goals}
        onStart={onStart}
        onToggleComplete={onToggleComplete}
        onDelete={onDelete}
        onExtend={onExtend}
        onRollToTomorrow={onRollToTomorrow}
        onDragStart={(id) => setDraggingId(id)}
        onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
      />

      {TIME_BLOCKS.map(block => {
        const blockTasks =
          block.id === 'morning'   ? morning
          : block.id === 'afternoon' ? afternoon
          : evening;
        const Icon = blockIcon(block.id);
        const accent =
          block.id === 'morning'   ? 'amber'
          : block.id === 'afternoon' ? 'cyan'
          : 'violet';
        return (
          <Column
            key={block.id}
            id={block.id}
            label={block.label}
            hint={block.hint}
            tasks={blockTasks}
            isDropTarget={dropTarget === block.id}
            draggingId={draggingId}
            onDragEnter={() => setDropTarget(block.id)}
            onDragLeave={() => setDropTarget(curr => curr === block.id ? null : curr)}
            onDropTask={(taskId) => {
              setDropTarget(null);
              handleDrop(taskId, block.id);
            }}
            headerIcon={<Icon className="w-3.5 h-3.5" />}
            accent={accent}
            activeTaskId={activeTaskId}
            isTimerActive={isTimerActive}
            isToday={isToday}
            canRollForward={canRollForward}
            goals={goals}
            onStart={onStart}
            onToggleComplete={onToggleComplete}
            onDelete={onDelete}
            onExtend={onExtend}
            onRollToTomorrow={onRollToTomorrow}
            onDragStart={(id) => setDraggingId(id)}
            onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
          />
        );
      })}
    </div>
  );
}

/* ─── Column ──────────────────────────────────────────────────────── */

type AccentKey = 'slate' | 'amber' | 'cyan' | 'violet';

// Tailwind classes are intentionally written as full literals so the JIT
// compiler picks them up at build time. Interpolating the accent into a
// template string would strip them from the bundle.
const ACCENT_CLASSES: Record<AccentKey, { border: string; text: string; glow: string }> = {
  slate:  { border: 'border-white/10',      text: 'text-white/40',  glow: 'bg-white/[0.02]' },
  amber:  { border: 'border-amber-400/40',  text: 'text-amber-300', glow: 'bg-amber-500/[0.05]' },
  cyan:   { border: 'border-cyan-400/40',   text: 'text-cyan-300',  glow: 'bg-cyan-500/[0.05]' },
  violet: { border: 'border-violet-400/40', text: 'text-violet-300', glow: 'bg-violet-500/[0.05]' },
};

function Column({
  id,
  label,
  hint,
  tasks,
  isDropTarget,
  draggingId,
  onDragEnter,
  onDragLeave,
  onDropTask,
  headerIcon,
  accent,
  activeTaskId,
  isTimerActive,
  isToday,
  canRollForward,
  goals,
  onStart,
  onToggleComplete,
  onDelete,
  onExtend,
  onRollToTomorrow,
  onDragStart,
  onDragEnd,
}: {
  id: DropTarget;
  label: string;
  hint: string;
  tasks: DailyTask[];
  isDropTarget: boolean;
  draggingId: string | null;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDropTask: (taskId: string) => void;
  headerIcon: React.ReactNode;
  accent: AccentKey;
  activeTaskId: string | null;
  isTimerActive: boolean;
  isToday: boolean;
  canRollForward: boolean;
  goals: Goal[];
  onStart: (taskId: string) => void;
  onToggleComplete: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onExtend: (taskId: string) => void;
  onRollToTomorrow: (task: DailyTask) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const a = ACCENT_CLASSES[accent];
  const pendingCount = tasks.filter(t => !t.completed).length;
  const totalPoms = tasks.reduce((s, t) => s + t.pomodoros_target, 0);
  const donePoms = tasks.reduce((s, t) => s + t.pomodoros_done, 0);

  return (
    <div
      onDragOver={(e) => {
        // Both preventDefault AND dropEffect are required for the browser
        // to treat this as a valid drop target on most engines.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        onDragEnter();
      }}
      onDragLeave={(e) => {
        // dragleave fires when moving over child elements too — only call
        // onDragLeave when the pointer actually exits this container.
        const related = e.relatedTarget as Node | null;
        if (!related || !(e.currentTarget as Node).contains(related)) {
          onDragLeave();
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId) onDropTask(taskId);
      }}
      className={`rounded-2xl border transition-colors p-2.5 min-h-[220px] flex flex-col ${
        isDropTarget
          ? `${a.border} ${a.glow}`
          : 'border-white/[0.06] bg-white/[0.01]'
      }`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-1 pb-2">
        <div className="flex items-center gap-1.5">
          <span className={a.text}>{headerIcon}</span>
          <span className="text-[10px] uppercase tracking-widest text-white/40 font-medium">
            {label}
          </span>
          {pendingCount > 0 && (
            <span className="text-[10px] text-white/25 font-mono">
              {pendingCount}
            </span>
          )}
        </div>
        {totalPoms > 0 && (
          <span className="text-[10px] text-white/20 font-mono tabular-nums">
            {donePoms}/{totalPoms}
          </span>
        )}
      </div>

      {/* Body — either cards or empty-state */}
      <div className="flex-1 space-y-1.5">
        {tasks.length === 0 ? (
          <div
            className={`flex items-center justify-center h-full min-h-[160px] rounded-xl border border-dashed text-[11px] ${
              isDropTarget ? `${a.border} ${a.text}` : 'border-white/[0.05] text-white/20'
            }`}
          >
            {isDropTarget ? 'Drop here' : hint}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {tasks.map(task => (
              <DraggableTaskCard
                key={task.id}
                task={task}
                isActive={task.id === activeTaskId && isTimerActive}
                isDragging={task.id === draggingId}
                isToday={isToday}
                canRollForward={canRollForward}
                goals={goals}
                timerBusy={isTimerActive}
                onDragStart={() => onDragStart(task.id)}
                onDragEnd={onDragEnd}
                onStart={() => onStart(task.id)}
                onToggle={() => onToggleComplete(task.id)}
                onDelete={() => onDelete(task.id)}
                onExtend={() => onExtend(task.id)}
                onRollToTomorrow={
                  canRollForward && !task.repeating && !task.completed
                    ? () => onRollToTomorrow(task)
                    : undefined
                }
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

/* ─── Card ────────────────────────────────────────────────────────── */

function DraggableTaskCard({
  task,
  isActive,
  isDragging,
  isToday,
  goals,
  timerBusy,
  onDragStart,
  onDragEnd,
  onStart,
  onToggle,
  onDelete,
  onExtend,
  onRollToTomorrow,
}: {
  task: DailyTask;
  isActive: boolean;
  isDragging: boolean;
  isToday: boolean;
  canRollForward: boolean;
  goals: Goal[];
  timerBusy: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onStart: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onExtend: () => void;
  onRollToTomorrow?: () => void;
}) {
  const tagInfo = getTagInfo(task.tag);
  const linkedGoal = task.goal_id ? goals.find(g => g.id === task.goal_id) : null;
  const completed = task.completed;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: isDragging ? 0.4 : 1, y: 0 }}
      exit={{ opacity: 0, x: -10, transition: { duration: 0.15 } }}
      draggable={!completed}
      onDragStart={(e) => {
        // Framer's motion.div onDragStart signature is loosely typed; cast
        // to the HTML5 event so we can write to dataTransfer. Completed
        // tasks aren't draggable (draggable={false}) so we guard anyway.
        const de = e as unknown as React.DragEvent<HTMLDivElement>;
        de.dataTransfer.setData('text/plain', task.id);
        de.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`group rounded-xl px-2.5 py-2 border transition-all ${
        isActive
          ? 'border-[var(--accent,#22d3ee)]/40 bg-[var(--accent,#22d3ee)]/[0.06]'
          : completed
            ? 'border-white/[0.04] bg-white/[0.01] opacity-50'
            : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16] cursor-grab active:cursor-grabbing'
      } ${task.goal_id ? 'border-l-2 border-l-violet-500/60' : ''}`}
    >
      <div className="flex items-start gap-2">
        {/* Play / checkbox — stopPropagation because the parent is draggable */}
        {!completed && isToday ? (
          <button
            onClick={(e) => { e.stopPropagation(); (timerBusy ? onToggle : onStart)(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`shrink-0 w-6 h-6 mt-0.5 rounded-md flex items-center justify-center transition ${
              timerBusy
                ? 'text-white/20 hover:text-white/40'
                : 'text-[var(--accent,#22d3ee)]/70 hover:text-[var(--accent,#22d3ee)] hover:bg-[var(--accent,#22d3ee)]/10'
            }`}
            title={timerBusy ? 'Mark complete' : 'Start pomodoro'}
          >
            {timerBusy ? <Circle className="w-3.5 h-3.5" /> : <Play className="w-3 h-3 fill-current" />}
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="shrink-0 w-6 h-6 mt-0.5 rounded-md flex items-center justify-center transition-colors"
          >
            {completed ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--accent,#22d3ee)]" />
            ) : (
              <Circle className="w-3.5 h-3.5 text-white/15 hover:text-white/30" />
            )}
          </button>
        )}

        <div className="flex-1 min-w-0">
          <p className={`text-[13px] leading-tight truncate ${
            completed ? 'text-white/30 line-through' : 'text-white/85'
          }`}>
            {task.title}
          </p>

          {/* Meta row: tag + pomodoro dots + linked goal badge */}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {tagInfo && (
              <span
                className="text-[9px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wider"
                style={{ color: tagInfo.color, backgroundColor: tagInfo.color + '15' }}
              >
                {tagInfo.label}
              </span>
            )}
            <div className="flex items-center gap-0.5">
              {Array.from({ length: task.pomodoros_target }).map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full ${
                    i < task.pomodoros_done ? 'bg-[var(--accent,#22d3ee)]' : 'bg-white/10'
                  }`}
                />
              ))}
            </div>
            {linkedGoal && !completed && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-violet-500/15 text-violet-300/80 truncate max-w-[90px]">
                {linkedGoal.title}
              </span>
            )}
          </div>
        </div>

        {/* Hover actions */}
        {!completed && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onExtend(); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-1 rounded text-[10px] text-white/30 hover:text-[var(--accent,#22d3ee)] hover:bg-[var(--accent,#22d3ee)]/10"
              title="Add 1 more pomodoro"
            >
              +1
            </button>
            {onRollToTomorrow && (
              <button
                onClick={(e) => { e.stopPropagation(); onRollToTomorrow(); }}
                onMouseDown={(e) => e.stopPropagation()}
                className="p-1 rounded text-white/25 hover:text-amber-300 hover:bg-amber-400/10"
                title="Roll forward one day"
              >
                <CalendarPlus className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-1 rounded text-white/25 hover:text-red-400 hover:bg-red-500/10"
              title="Delete"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

