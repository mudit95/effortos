'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Flame, Clock, Target, BookOpen, PlusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DailySession {
  date: string;
  count: number;
}

interface StreakCalendarProps {
  // Array of daily sessions: { date, count }
  dailySessions?: DailySession[];
  // OR: Map of date string (YYYY-MM-DD) to pomodoro count for that day (legacy format)
  dailyData?: Record<string, number>;
  currentStreak?: number;
  bestStreak?: number;
  // NEW: target sessions per day for performance coloring
  recommendedDaily?: number;
  // NEW: focus duration in seconds (default 25 min)
  focusDurationSec?: number;
  className?: string;
  onDayClick?: (date: string) => void;
  // Dates (YYYY-MM-DD) that already have a journal entry. Used to show
  // an indicator dot on the cell and to swap the tooltip CTA between
  // "Add journal entry" and "View journal entry". Passed as an array
  // for ergonomics; we normalize to a Set internally for O(1) lookup.
  journalDates?: string[];
}

type HoverInfo = {
  dateStr: string;
  day: number;
  month: number;
  year: number;
  count: number;
  perf: number; // 0-1 fill
  isToday: boolean;
  isFuture: boolean;
  hasJournal: boolean;
  // anchor rect for positioning
  rect: { left: number; top: number; width: number; height: number };
};

export function StreakCalendar({
  dailySessions,
  dailyData,
  currentStreak: providedCurrentStreak,
  bestStreak: providedBestStreak,
  recommendedDaily,
  focusDurationSec = 25 * 60,
  className = '',
  onDayClick,
  journalDates,
}: StreakCalendarProps) {
  // Normalize the journal date array to a Set for O(1) membership checks
  // inside the render loop (one lookup per cell, 35+ cells per month).
  const journalDateSet = useMemo(
    () => new Set(journalDates ?? []),
    [journalDates],
  );
  // Convert dailySessions to dailyData map if needed
  const dataMap = useMemo(() => {
    if (dailyData) return dailyData;
    const map: Record<string, number> = {};
    if (dailySessions) {
      dailySessions.forEach(({ date, count }) => {
        map[date] = count;
      });
    }
    return map;
  }, [dailyData, dailySessions]);

  // Calculate streaks if not provided
  const { currentStreak, bestStreak } = useMemo(() => {
    if (providedCurrentStreak !== undefined && providedBestStreak !== undefined) {
      return {
        currentStreak: providedCurrentStreak,
        bestStreak: providedBestStreak,
      };
    }

    // Calculate streaks from data
    let current = 0;
    let best = 0;
    let tempStreak = 0;

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();
    const currentDay = today.getDate();

    // Check from today backwards
    let checkDate = new Date(currentYear, currentMonth, currentDay);

    while (true) {
      const dateStr = checkDate.toISOString().split('T')[0];
      const count = dataMap[dateStr] || 0;

      if (count > 0) {
        tempStreak++;
        best = Math.max(best, tempStreak);
      } else {
        const isToday =
          checkDate.getFullYear() === currentYear &&
          checkDate.getMonth() === currentMonth &&
          checkDate.getDate() === currentDay;
        const isYesterday = new Date(checkDate.getTime() + 86400000).toDateString() === today.toDateString();

        if (isToday || isYesterday) {
          current = tempStreak;
        } else {
          break;
        }
      }

      checkDate = new Date(checkDate.getTime() - 86400000);
      if (checkDate.getFullYear() < currentYear - 2) break;
    }

    return { currentStreak: current, bestStreak: best };
  }, [dataMap, providedCurrentStreak, providedBestStreak]);

  const [displayDate, setDisplayDate] = useState<Date>(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const currentDay = today.getDate();

  // First day of displayed month
  const firstDayOfMonth = new Date(displayDate.getFullYear(), displayDate.getMonth(), 1);
  const lastDayOfMonth = new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 0);
  const firstDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7;
  const daysInMonth = lastDayOfMonth.getDate();

  const formatDate = (year: number, month: number, day: number): string =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const isTodayDate = (year: number, month: number, day: number): boolean =>
    year === currentYear && month === currentMonth && day === currentDay;

  const isFutureDate = (year: number, month: number, day: number): boolean => {
    const checkDate = new Date(year, month, day);
    const todayDate = new Date(currentYear, currentMonth, currentDay);
    return checkDate > todayDate;
  };

  // Compute max value for this month so we can fall back if no target exists
  const maxValue = useMemo(() => {
    let max = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = formatDate(displayDate.getFullYear(), displayDate.getMonth(), day);
      const value = dataMap[dateStr] || 0;
      max = Math.max(max, value);
    }
    return Math.max(1, max);
  }, [displayDate, dataMap, daysInMonth]);

  // Performance ratio 0..1 — relative to recommendedDaily target when available,
  // otherwise relative to the visible month's max so the calendar still conveys
  // a sense of relative intensity.
  const getPerformance = (count: number): number => {
    if (count <= 0) return 0;
    const target = recommendedDaily && recommendedDaily > 0 ? recommendedDaily : maxValue;
    return Math.min(1, count / target);
  };

  // Cell background — quantized color ramp from low to high performance.
  // Uses cyan→emerald to signal "meeting or exceeding target".
  const getCellBg = (perf: number): string => {
    if (perf <= 0) return 'bg-white/[0.03]';
    if (perf < 0.25) return 'bg-cyan-500/15';
    if (perf < 0.5) return 'bg-cyan-500/30';
    if (perf < 0.75) return 'bg-cyan-500/50';
    if (perf < 1) return 'bg-cyan-500/70';
    return 'bg-emerald-500/70';
  };

  const goToPreviousMonth = () =>
    setDisplayDate(new Date(displayDate.getFullYear(), displayDate.getMonth() - 1, 1));
  const goToNextMonth = () =>
    setDisplayDate(new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 1));

  const calendarDays = useMemo(() => {
    const days: Array<number | null> = [];
    for (let i = 0; i < firstDayOfWeek; i++) days.push(null);
    for (let day = 1; day <= daysInMonth; day++) days.push(day);
    return days;
  }, [firstDayOfWeek, daysInMonth]);

  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const monthName = displayDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const canGoForward = !(
    displayDate.getFullYear() === currentYear && displayDate.getMonth() === currentMonth
  );

  // ── Hover tooltip state ─────────────────────────────────────────────
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const handleMouseEnter = (
    e: React.MouseEvent<HTMLButtonElement>,
    payload: Omit<HoverInfo, 'rect'>,
  ) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    setHover({
      ...payload,
      rect: {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      },
    });
  };
  const handleMouseLeave = () => setHover(null);

  // Readable date string for tooltip — "Tue, Apr 15"
  const formatTooltipDate = (y: number, m: number, d: number): string => {
    const dt = new Date(y, m, d);
    return dt.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className={cn('w-full', className)}>
      {/* Month Navigation Header */}
      <div className="flex items-center justify-between mb-4 px-2">
        <button
          onClick={goToPreviousMonth}
          className="p-1.5 hover:bg-white/5 rounded-md transition-colors duration-200"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4 text-white/60" />
        </button>

        <h3 className="text-sm font-semibold text-white">{monthName}</h3>

        <button
          onClick={goToNextMonth}
          disabled={!canGoForward}
          className={cn(
            'p-1.5 rounded-md transition-colors duration-200',
            canGoForward ? 'hover:bg-white/5' : 'opacity-30 cursor-not-allowed',
          )}
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4 text-white/60" />
        </button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 gap-1 mb-2 px-2">
        {dayLabels.map((label) => (
          <div
            key={label}
            className="text-xs text-white/40 text-center font-medium py-1"
          >
            {label.charAt(0)}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1 px-2 mb-4">
        {calendarDays.map((day, index) => {
          if (day === null) {
            return <div key={`empty-${index}`} className="aspect-square" />;
          }

          const y = displayDate.getFullYear();
          const m = displayDate.getMonth();
          const dateStr = formatDate(y, m, day);
          const count = dataMap[dateStr] || 0;
          const perf = getPerformance(count);
          const isTodayCell = isTodayDate(y, m, day);
          const isFutureCell = isFutureDate(y, m, day);
          const hasJournal = journalDateSet.has(dateStr);

          return (
            <motion.button
              key={dateStr}
              onClick={() => onDayClick?.(dateStr)}
              onMouseEnter={(e) =>
                !isFutureCell &&
                handleMouseEnter(e, {
                  dateStr,
                  day,
                  month: m,
                  year: y,
                  count,
                  perf,
                  isToday: isTodayCell,
                  isFuture: isFutureCell,
                  hasJournal,
                })
              }
              onMouseLeave={handleMouseLeave}
              whileHover={!isFutureCell ? { scale: 1.05 } : {}}
              whileTap={!isFutureCell ? { scale: 0.98 } : {}}
              className={cn(
                'aspect-square rounded-md transition-all duration-200 relative overflow-hidden',
                'flex items-center justify-center text-xs font-medium',
                'cursor-pointer',
                getCellBg(perf),
                isTodayCell && 'ring-2 ring-cyan-400/70 ring-inset',
                isFutureCell && 'border border-dashed border-white/20 cursor-default',
              )}
              disabled={isFutureCell}
              aria-label={
                `${dateStr}: ${count} pomodoros` +
                (hasJournal ? ' · journal entry present' : '')
              }
            >
              {/* Fill-level bar at bottom of the cell — shows pace toward target */}
              {!isFutureCell && perf > 0 && (
                <span
                  className={cn(
                    'absolute bottom-0 left-0 h-[3px] rounded-full',
                    perf >= 1 ? 'bg-emerald-400' : 'bg-cyan-300',
                  )}
                  style={{ width: `${Math.round(perf * 100)}%` }}
                  aria-hidden
                />
              )}
              {/* Journal indicator — tiny dot in the top-right corner of the
                  cell when an entry exists for this date. Uses amber so it
                  reads as distinct from the cyan/emerald performance ramp.
                  On today's cell we nudge it slightly to avoid visually
                  crashing into the ring-inset. */}
              {hasJournal && !isFutureCell && (
                <span
                  className={cn(
                    'absolute rounded-full bg-amber-300/90 shadow-[0_0_4px_rgba(251,191,36,0.6)]',
                    isTodayCell ? 'top-1 right-1 w-1 h-1' : 'top-0.5 right-0.5 w-1.5 h-1.5',
                  )}
                  aria-hidden
                />
              )}
              <span className="relative text-white/70 text-xs">{day}</span>
            </motion.button>
          );
        })}
      </div>

      {/* Streak Badge */}
      <div className="flex items-center justify-center gap-2 text-sm text-white/80 px-2 py-2 bg-white/[0.02] rounded-lg border border-white/10">
        <Flame className="w-3.5 h-3.5 text-orange-400" />
        <span className="font-semibold">{currentStreak}</span>
        <span className="text-white/50">day streak</span>
        <span className="text-white/30">·</span>
        <span className="text-white/50">Best:</span>
        <span className="font-semibold text-white">{bestStreak}</span>
      </div>

      {/* ── Rich hover tooltip ─────────────────────────────────────── */}
      <AnimatePresence>
        {hover && (
          <CalendarTooltip
            hover={hover}
            focusDurationSec={focusDurationSec}
            recommendedDaily={recommendedDaily}
            formatDate={formatTooltipDate}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Tooltip component rendered at the calendar root so it can escape overflow
// and be positioned via fixed coordinates relative to the hovered cell.
function CalendarTooltip({
  hover,
  focusDurationSec,
  recommendedDaily,
  formatDate,
}: {
  hover: HoverInfo;
  focusDurationSec: number;
  recommendedDaily?: number;
  formatDate: (y: number, m: number, d: number) => string;
}) {
  const hours = +(hover.count * (focusDurationSec / 3600)).toFixed(1);
  const pct = Math.round(hover.perf * 100);
  const label = formatDate(hover.year, hover.month, hover.day);

  // Center the tooltip above the cell
  const left = hover.rect.left + hover.rect.width / 2;
  const top = hover.rect.top;

  const performanceLabel =
    hover.count <= 0
      ? 'No sessions'
      : hover.perf >= 1
      ? 'Hit target 🔥'
      : hover.perf >= 0.75
      ? 'Strong day'
      : hover.perf >= 0.5
      ? 'Steady'
      : hover.perf >= 0.25
      ? 'Light day'
      : 'Warm-up';

  return (
    <motion.div
      initial={{ opacity: 0, y: 4, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.96 }}
      transition={{ duration: 0.12 }}
      // pointer-events-none so hover doesn't bounce between cell and tooltip
      className="pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-[calc(100%+10px)]"
      style={{ left, top }}
      role="tooltip"
    >
      <div className="min-w-[200px] rounded-lg border border-white/10 bg-[#0B0F14]/95 backdrop-blur-md shadow-xl p-3 text-left">
        <div className="text-[11px] text-white/40 uppercase tracking-wider mb-1">
          {label}
          {hover.isToday && <span className="ml-1.5 text-cyan-400/80 normal-case">· Today</span>}
        </div>
        <div className="text-sm font-semibold text-white mb-2">{performanceLabel}</div>

        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-white/70">
            <span className="inline-flex items-center gap-1.5">
              <Target className="w-3 h-3 text-cyan-400/80" />
              Sessions
            </span>
            <span className="font-medium text-white">
              {hover.count}
              {recommendedDaily ? (
                <span className="text-white/40 font-normal"> / {recommendedDaily}</span>
              ) : null}
            </span>
          </div>
          <div className="flex items-center justify-between text-white/70">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-cyan-400/80" />
              Focus
            </span>
            <span className="font-medium text-white">{hours}h</span>
          </div>
          {hover.count > 0 && (
            <div className="flex items-center justify-between text-white/70">
              <span className="inline-flex items-center gap-1.5">
                <Flame className="w-3 h-3 text-orange-400/80" />
                Pace
              </span>
              <span
                className={cn(
                  'font-medium',
                  hover.perf >= 1
                    ? 'text-emerald-300'
                    : hover.perf >= 0.5
                    ? 'text-cyan-300'
                    : 'text-white/70',
                )}
              >
                {pct}%
              </span>
            </div>
          )}
        </div>

        {/* Journal CTA — swaps label based on existence. Not a button
            because the whole cell is already the click target; this is
            pure signal. */}
        <div className="mt-2.5 pt-2 border-t border-white/[0.06] flex items-center gap-1.5">
          {hover.hasJournal ? (
            <>
              <BookOpen className="w-3 h-3 text-amber-300/90" />
              <span className="text-[11px] text-amber-200/80 font-medium">
                Click to view journal entry
              </span>
            </>
          ) : (
            <>
              <PlusCircle className="w-3 h-3 text-cyan-400/80" />
              <span className="text-[11px] text-white/55">
                Click to add journal entry
              </span>
            </>
          )}
        </div>
      </div>
      {/* caret */}
      <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 rotate-45 bg-[#0B0F14]/95 border-r border-b border-white/10" />
    </motion.div>
  );
}
