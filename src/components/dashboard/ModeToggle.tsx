'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { ListChecks, Target, BarChart3 } from 'lucide-react';
import type { DashboardMode } from '@/types';

export function ModeToggle() {
  const dashboardMode = useStore(s => s.dashboardMode);
  const setDashboardMode = useStore(s => s.setDashboardMode);

  const modes: { id: DashboardMode; label: string; icon: React.ReactNode }[] = [
    { id: 'daily', label: 'Daily Grind', icon: <ListChecks className="w-3.5 h-3.5" /> },
    { id: 'longterm', label: 'Long Term', icon: <Target className="w-3.5 h-3.5" /> },
    { id: 'reports', label: 'Reports', icon: <BarChart3 className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="inline-flex items-center rounded-xl bg-white/[0.03] border border-white/[0.06] p-0.5">
      {modes.map((mode) => (
        <button
          key={mode.id}
          onClick={() => setDashboardMode(mode.id)}
          className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-medium transition-colors"
        >
          {dashboardMode === mode.id && (
            <motion.div
              layoutId="mode-toggle-bg"
              className="absolute inset-0 rounded-[10px] bg-white/[0.08] border border-white/[0.08]"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
          <span className={`relative z-10 flex items-center gap-1.5 ${
            dashboardMode === mode.id ? 'text-white' : 'text-white/30 hover:text-white/50'
          }`}>
            {mode.icon}
            {mode.label}
          </span>
        </button>
      ))}
    </div>
  );
}
