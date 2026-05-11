'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { ListChecks, Target, BarChart3 } from 'lucide-react';
import type { DashboardMode } from '@/types';

/**
 * Top-nav switcher between the three dashboard views.
 *
 * Visual hierarchy follows the product pivot: "Today" is the hero, so
 * its tab is rendered with stronger weight and an icon-leading label;
 * Long Term and Reports are secondary destinations and read as quieter
 * outline-only tabs. The container is now a flat horizontal strip
 * suitable for placing in the dashboard header (left-aligned), not the
 * centered pill it was before — which made all three feel equally
 * important.
 *
 * Rename: "Daily Grind" → "Today". The new product framing leads with
 * the day&apos;s tasks, and "Today" is the clearest one-word label for
 * what the user is looking at.
 */
export function ModeToggle() {
  const dashboardMode = useStore(s => s.dashboardMode);
  const setDashboardMode = useStore(s => s.setDashboardMode);

  // Order matters: hero first, then the two secondary destinations.
  const modes: { id: DashboardMode; label: string; icon: React.ReactNode; primary?: boolean }[] = [
    { id: 'daily', label: 'Today', icon: <ListChecks className="w-4 h-4" />, primary: true },
    { id: 'longterm', label: 'Long Term', icon: <Target className="w-3.5 h-3.5" /> },
    { id: 'reports', label: 'Reports', icon: <BarChart3 className="w-3.5 h-3.5" /> },
  ];

  return (
    <div
      role="tablist"
      aria-label="Dashboard view"
      className="inline-flex items-center gap-1"
    >
      {modes.map((mode) => {
        const isActive = dashboardMode === mode.id;
        return (
          <button
            key={mode.id}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => setDashboardMode(mode.id)}
            className={`relative flex items-center gap-1.5 rounded-lg font-medium transition-colors ${
              mode.primary ? 'px-3.5 py-1.5 text-sm' : 'px-3 py-1.5 text-xs'
            }`}
          >
            {isActive && (
              <motion.div
                layoutId="mode-toggle-bg"
                className="absolute inset-0 rounded-lg bg-white/[0.07] border border-white/[0.08]"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span
              className={`relative z-10 flex items-center gap-1.5 ${
                isActive
                  ? mode.primary
                    ? 'text-white'
                    : 'text-white/85'
                  : mode.primary
                    ? 'text-white/45 hover:text-white/70'
                    : 'text-white/35 hover:text-white/55'
              }`}
            >
              {mode.icon}
              {mode.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
