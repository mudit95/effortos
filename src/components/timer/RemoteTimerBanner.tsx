'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Smartphone, Laptop, Tablet, Tv } from 'lucide-react';
import { useStore } from '@/store/useStore';

/**
 * "Timer running on another device" banner.
 *
 * useRealtimeSync (src/hooks/useRealtimeSync.ts) already populates
 * `remoteTimerInfo` whenever Supabase Realtime sees a `timer_state` row
 * change from a non-web device. Until now NO UI consumed that field —
 * users could start a Pomodoro on their phone, open the dashboard on
 * their laptop, and see no indication that another device was already
 * counting. Two timers ran in parallel and the session log got messy.
 *
 * This banner surfaces the remote run, with a live countdown derived from
 * `(remaining - elapsed-since-update)`. We deliberately don't expose a
 * "take over" button yet — the underlying timer-state ownership semantics
 * (device+session_id arbitration) are not yet airtight, and a half-implemented
 * takeover flow would create more user confusion than it solves. For
 * launch, awareness alone is the high-value win.
 */
export function RemoteTimerBanner() {
  const remote = useStore((s) => s.remoteTimerInfo);

  // We track `now` in state and tick it from a setInterval. Computing
  // `Date.now()` directly in render is flagged by React 19's purity rule
  // (impure function during render); putting it in state keeps the
  // render itself a pure function of props + state.
  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (!remote || !remote.isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [remote, remote?.isRunning]);

  if (!remote) return null;

  // Stale-info guard: if the remote update is more than 2 minutes old,
  // assume the remote device went offline and stop showing the banner.
  const ageMs = now - new Date(remote.updatedAt).getTime();
  if (ageMs > 2 * 60 * 1000) return null;

  // Compute live remaining: subtract seconds elapsed since the last
  // remote-state update. Clamp to zero.
  const elapsedSec = Math.floor(ageMs / 1000);
  const liveRemaining = remote.isRunning
    ? Math.max(0, remote.remaining - elapsedSec)
    : remote.remaining;
  const mm = Math.floor(liveRemaining / 60);
  const ss = liveRemaining % 60;
  const timeStr = `${mm}:${String(ss).padStart(2, '0')}`;

  const deviceLabel = humanDevice(remote.device);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        className="mx-4 mt-4 mb-2 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] px-4 py-3 flex items-center gap-3"
        role="status"
        aria-live="polite"
      >
        <div className="w-8 h-8 rounded-full bg-cyan-400/15 border border-cyan-400/25 flex items-center justify-center flex-shrink-0">
          {/* The lint rule "Cannot create components during render" trips
              when we bind the result of pickDeviceIcon to a capital-letter
              variable and use it as JSX. Switching the dispatch to return a
              ready-rendered element keeps the render path a pure data
              transform, no per-render component creation. */}
          {renderDeviceIcon(remote.device)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-cyan-100">
            {remote.isRunning ? 'Timer running on' : 'Timer paused on'} {deviceLabel}
          </p>
          <p className="text-[11px] text-cyan-200/60 tabular-nums">
            {remote.isRunning ? `${timeStr} remaining` : 'Picked up where you left off'}
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function renderDeviceIcon(device: string): React.ReactElement {
  const cls = 'w-4 h-4 text-cyan-300';
  switch (device) {
    case 'ios':
    case 'android':
      return <Smartphone className={cls} />;
    case 'tablet':
      return <Tablet className={cls} />;
    case 'tv':
      return <Tv className={cls} />;
    default:
      return <Laptop className={cls} />;
  }
}

function humanDevice(device: string): string {
  switch (device) {
    case 'ios':     return 'iPhone';
    case 'android': return 'Android';
    case 'tablet':  return 'tablet';
    case 'tv':      return 'TV';
    case 'web':     return 'web';
    default:        return 'another device';
  }
}
