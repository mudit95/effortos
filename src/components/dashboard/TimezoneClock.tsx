'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Search, Check } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

// A curated-but-broad list of common IANA zones. We also include whatever the
// browser reports so the user always sees their local zone even if it's not
// in this list. This keeps the picker usable without shipping the full ~600
// zone IANA database.
const COMMON_ZONES: string[] = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/New_York',
  'America/Halifax',
  'America/Sao_Paulo',
  'America/Mexico_City',
  'Atlantic/Azores',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Asia/Dubai',
  'Asia/Tehran',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

function getOffsetLabel(timeZone: string, now: Date): string {
  // Use Intl to get the zone's GMT offset string (e.g. "GMT+5:30").
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(now);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    return tzPart?.value || '';
  } catch {
    return '';
  }
}

function formatTimeInZone(timeZone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(now);
  } catch {
    return '';
  }
}

function friendlyLabel(tz: string): string {
  // "America/Los_Angeles" → "Los Angeles"
  const parts = tz.split('/');
  return parts[parts.length - 1].replace(/_/g, ' ');
}

export function TimezoneClock() {
  const user = useStore((s) => s.user);
  const addToast = useStore((s) => s.addToast);

  const detectedZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);

  const currentZone = user?.timezone || detectedZone || 'UTC';

  // Tick every 30 seconds so the minute display stays accurate without being
  // wasteful. We store the tick count rather than a Date object because a new
  // Date is cheap and we only need to re-render.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const now = new Date();
  const timeStr = formatTimeInZone(currentZone, now);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  // Build the filtered zone list — include detected + current if missing.
  const zones = useMemo(() => {
    const all = new Set<string>(COMMON_ZONES);
    if (detectedZone) all.add(detectedZone);
    if (currentZone) all.add(currentZone);
    const q = query.trim().toLowerCase();
    const list = Array.from(all);
    return list
      .filter((z) => !q || z.toLowerCase().includes(q))
      .sort((a, b) => a.localeCompare(b));
  }, [query, detectedZone, currentZone]);

  const handleSelect = async (tz: string) => {
    if (tz === currentZone || saving) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      // Persist to local store immediately for responsive UI
      if (user) {
        useStore.setState({ user: { ...user, timezone: tz } });
      }

      // Persist to cloud if configured
      if (isSupabaseConfigured()) {
        try {
          const supabase = createClient();
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            await supabase.from('profiles').update({ timezone: tz }).eq('id', session.user.id);
            // Also sync email prefs so cron sends use the correct window
            fetch('/api/email-preferences', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ timezone: tz }),
            }).catch(() => {});
          }
        } catch {
          /* non-fatal */
        }
      }

      addToast(`Timezone set to ${friendlyLabel(tz)}`, 'success');
    } catch {
      addToast('Could not save timezone', 'error');
    } finally {
      setSaving(false);
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'h-8 px-2.5 rounded-lg flex items-center gap-1.5 transition-all',
          'text-xs font-medium text-white/60 hover:text-white/90 hover:bg-white/[0.05]',
          open && 'bg-white/[0.06] text-white/90',
        )}
        title={`Your timezone: ${currentZone}. Click to change.`}
        aria-label="Timezone"
      >
        <Clock className="w-3.5 h-3.5" />
        <span className="tabular-nums">{timeStr}</span>
        <span className="hidden md:inline text-white/30 text-[10px] uppercase tracking-wider ml-1">
          {friendlyLabel(currentZone)}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-[calc(100%+6px)] w-[300px] rounded-xl border border-white/10 bg-[#0B0F14]/95 backdrop-blur-xl shadow-2xl z-50 overflow-hidden"
          >
            <div className="p-3 border-b border-white/[0.06]">
              <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
                Your timezone
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white font-medium truncate">
                    {friendlyLabel(currentZone)}
                  </div>
                  <div className="text-[11px] text-white/40 truncate">
                    {currentZone} · {getOffsetLabel(currentZone, now)}
                  </div>
                </div>
                <div className="text-sm font-mono text-cyan-300 tabular-nums">{timeStr}</div>
              </div>
            </div>

            <div className="p-2 border-b border-white/[0.06]">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-white/30 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search city or region"
                  className="w-full h-8 pl-8 pr-2 text-xs bg-white/[0.04] border border-white/[0.06] rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500/40"
                />
              </div>
            </div>

            <div className="max-h-[260px] overflow-y-auto py-1">
              {zones.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-white/40">
                  No matches
                </div>
              )}
              {zones.map((tz) => {
                const isCurrent = tz === currentZone;
                return (
                  <button
                    key={tz}
                    onClick={() => handleSelect(tz)}
                    disabled={saving}
                    className={cn(
                      'w-full px-3 py-2 flex items-center justify-between gap-2 text-left transition-colors',
                      'hover:bg-white/[0.04]',
                      isCurrent && 'bg-cyan-500/[0.06]',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-white truncate">{friendlyLabel(tz)}</div>
                      <div className="text-[10px] text-white/30 truncate">
                        {tz} · {getOffsetLabel(tz, now)}
                      </div>
                    </div>
                    <div className="text-[11px] font-mono text-white/50 tabular-nums shrink-0">
                      {formatTimeInZone(tz, now)}
                    </div>
                    {isCurrent && <Check className="w-3 h-3 text-cyan-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
