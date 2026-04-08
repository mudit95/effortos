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
    { id: 'daily', label: 'Daily Grind', icon: <ListChecks className="w-4 h-4" /> },
    { id: 'longterm', label: 'Long Term', icon: <Target className="w-4 h-4" /> },
    { id: 'reports', label: 'Reports', icon: <BarChart3 className="w-4 h-4" /> },
  ];

  return (
    <div className="inline-flex items-center rounded-2xl bg-white/[0.04] border border-white/[0.08] p-1 gap-0.5">
      {modes.map((mode) => (
        <button
          key={mode.id}
          onClick={() => setDashboardMode(mode.id)}
          className="relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
        >
          {dashboardMode === mode.id && (
            <motion.div
              layoutId="mode-toggle-bg"
              className="absolute inset-0 rounded-xl bg-white/[0.10] border border-white/[0.10] shadow-sm"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
          <span className={`relative z-10 flex items-center gap-2 ${
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
