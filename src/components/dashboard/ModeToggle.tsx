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

  // Equal typography across all three modes — they&apos;re peer
  // destinations. Today is still the visual anchor through the active
  // background + border treatment, but Long Term and Reports should
  // not read as footnotes. Earlier shrunken-text version over-corrected
  // the demotion and made them feel like settings links instead of
  // real navigation.
  const modes: { id: DashboardMode; label: string; icon: React.ReactNode }[] = [
    { id: 'daily', label: 'Today', icon: <ListChecks className="w-4 h-4" /> },
    { id: 'longterm', label: 'Long Term', icon: <Target className="w-4 h-4" /> },
    { id: 'reports', label: 'Reports', icon: <BarChart3 className="w-4 h-4" /> },
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
            className="relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors"
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
                isActive ? 'text-white' : 'text-white/45 hover:text-white/75'
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
