'use client';

import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
  className?: string;
  onDayClick?: (date: string) => void;
}

export function StreakCalendar({
  dailySessions,
  dailyData,
  currentStreak: providedCurrentStreak,
  bestStreak: providedBestStreak,
  className = '',
  onDayClick,
}: StreakCalendarProps) {
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
        // Break in streak - check if this is today or yesterday
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

      checkDate = new Date(checkDate.getTime() - 86400000); // Go back 1 day
      if (checkDate.getFullYear() < currentYear - 2) break; // Don't go back too far
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

  // Get the first day of the month
  const firstDayOfMonth = new Date(displayDate.getFullYear(), displayDate.getMonth(), 1);
  const lastDayOfMonth = new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 0);

  // 0 = Monday, 6 = Sunday (getDay returns 0 = Sunday, so we adjust)
  const firstDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7;
  const daysInMonth = lastDayOfMonth.getDate();

  // Format date as YYYY-MM-DD
  const formatDate = (year: number, month: number, day: number): string => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  // Check if a date is today
  const isToday = (year: number, month: number, day: number): boolean => {
    return (
      year === currentYear &&
      month === currentMonth &&
      day === currentDay
    );
  };

  // Check if a date is in the future
  const isFuture = (year: number, month: number, day: number): boolean => {
    const checkDate = new Date(year, month, day);
    const todayDate = new Date(currentYear, currentMonth, currentDay);
    return checkDate > todayDate;
  };

  // Calculate max value for the visible month
  const maxValue = useMemo(() => {
    let max = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = formatDate(displayDate.getFullYear(), displayDate.getMonth(), day);
      const value = dataMap[dateStr] || 0;
      max = Math.max(max, value);
    }
    return Math.max(1, max);
  }, [displayDate, dataMap, daysInMonth]);

  // Get heatmap color based on intensity
  const getHeatmapColor = (count: number): string => {
    if (count === 0) return 'bg-white/[0.03]';
    const intensity = count / maxValue;
    if (intensity < 0.25) return 'bg-cyan-500/15';
    if (intensity < 0.5) return 'bg-cyan-500/30';
    if (intensity < 0.75) return 'bg-cyan-500/50';
    return 'bg-cyan-500/70';
  };

  // Navigate to previous month
  const goToPreviousMonth = () => {
    setDisplayDate(
      new Date(displayDate.getFullYear(), displayDate.getMonth() - 1, 1)
    );
  };

  // Navigate to next month
  const goToNextMonth = () => {
    setDisplayDate(
      new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 1)
    );
  };

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const days = [];

    // Add empty cells for days before the month starts
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push(null);
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day);
    }

    return days;
  }, [firstDayOfWeek, daysInMonth]);

  // Day labels (Mon-Sun)
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Format month/year for display
  const monthName = displayDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  // Check if we can navigate forward (not beyond current month)
  const canGoForward = !(
    displayDate.getFullYear() === currentYear &&
    displayDate.getMonth() === currentMonth
  );

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

        <h3 className="text-sm font-semibold text-white">
          {monthName}
        </h3>

        <button
          onClick={goToNextMonth}
          disabled={!canGoForward}
          className={cn(
            'p-1.5 rounded-md transition-colors duration-200',
            canGoForward
              ? 'hover:bg-white/5'
              : 'opacity-30 cursor-not-allowed'
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
            return (
              <div
                key={`empty-${index}`}
                className="aspect-square"
              />
            );
          }

          const dateStr = formatDate(displayDate.getFullYear(), displayDate.getMonth(), day);
          const count = dataMap[dateStr] || 0;
          const isTodayCell = isToday(displayDate.getFullYear(), displayDate.getMonth(), day);
          const isFutureCell = isFuture(displayDate.getFullYear(), displayDate.getMonth(), day);

          return (
            <motion.button
              key={dateStr}
              onClick={() => onDayClick?.(dateStr)}
              whileHover={!isFutureCell ? { scale: 1.05 } : {}}
              whileTap={!isFutureCell ? { scale: 0.98 } : {}}
              className={cn(
                'aspect-square rounded-md transition-all duration-200 relative',
                'flex items-center justify-center text-xs font-medium',
                'cursor-pointer',
                getHeatmapColor(count),
                isTodayCell && 'ring-2 ring-cyan-400/70 ring-inset',
                isFutureCell && 'border border-dashed border-white/20 cursor-default'
              )}
              title={`${dateStr}: ${count} pomodoros`}
              disabled={isFutureCell}
            >
              <span className="text-white/70 text-xs">{day}</span>
            </motion.button>
          );
        })}
      </div>

      {/* Streak Badge */}
      <div className="flex items-center justify-center gap-2 text-sm text-white/80 px-2 py-2 bg-white/[0.02] rounded-lg border border-white/10">
        <span>🔥</span>
        <span className="font-semibold">{currentStreak}</span>
        <span className="text-white/50">day streak</span>
        <span className="text-white/30">·</span>
        <span className="text-white/50">Best:</span>
        <span className="font-semibold text-white">{bestStreak}</span>
      </div>
    </div>
  );
}
