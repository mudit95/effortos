'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Timer, Plus, Trash2, X, Check } from 'lucide-react';
import { useStore } from '@/store/useStore';
import {
  getAllPresets,
  saveCustomPreset,
  deleteCustomPreset,
  findPresetByDurations,
  type TimerPreset,
} from '@/lib/timer-presets';

/**
 * Quick preset switcher for FocusMode. Sits inline in the focus-mode
 * top bar. Tapping the current preset opens a dropdown of all
 * available presets (5 bundled + up to 8 user-custom). Selecting one
 * updates focus_duration + break_duration via updateSettings.
 *
 * The "Add custom" path opens an inline form (focus min, break min,
 * label) without leaving the popover. Power users can build their own
 * 7/52 or 22/8 in two seconds.
 *
 * Why this is a separate component instead of in Settings:
 *   - In-context: the user is in focus-mode and wants to switch
 *     preset for THIS session. Sending them to Settings breaks flow.
 *   - The current preset is itself a derived value (we look up which
 *     bundled/custom preset matches the active focus_duration /
 *     break_duration), so the picker can show the user where they
 *     are without storing an explicit "current preset id" field.
 *
 * UX note: changing the preset mid-running-session is rare but
 * possible; the existing useStore.updateSettings + TimerEngine wiring
 * means new durations apply on the NEXT session start, not the current
 * one. We don't try to mutate a running countdown — that's a footgun.
 */

export function TimerPresetPicker() {
  const user = useStore((s) => s.user);
  const updateSettings = useStore((s) => s.updateSettings);

  const focusMin = Math.round((user?.settings?.focus_duration ?? 25 * 60) / 60);
  const breakMin = Math.round((user?.settings?.break_duration ?? 5 * 60) / 60);

  const current = findPresetByDurations(focusMin, breakMin);

  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [presets, setPresets] = useState<TimerPreset[]>(() => getAllPresets());
  const [draftFocus, setDraftFocus] = useState('30');
  const [draftBreak, setDraftBreak] = useState('5');
  const [draftLabel, setDraftLabel] = useState('');

  const popRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Outside-click + Escape close
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        popRef.current && !popRef.current.contains(t) &&
        btnRef.current && !btnRef.current.contains(t)
      ) {
        setOpen(false);
        setShowAdd(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setShowAdd(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handlePick = (p: TimerPreset) => {
    updateSettings({
      focus_duration: p.focus * 60,
      break_duration: p.break * 60,
    });
    setOpen(false);
    setShowAdd(false);
  };

  const handleSaveCustom = () => {
    const f = parseInt(draftFocus, 10);
    const b = parseInt(draftBreak, 10);
    if (!Number.isFinite(f) || f < 1 || f > 240) return;
    if (!Number.isFinite(b) || b < 0 || b > 60) return;
    const saved = saveCustomPreset(draftLabel || `${f}/${b}`, f, b);
    setPresets(getAllPresets());
    handlePick(saved);
    setShowAdd(false);
    setDraftLabel('');
  };

  const handleDeleteCustom = (id: string) => {
    deleteCustomPreset(id);
    setPresets(getAllPresets());
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="Timer preset"
        aria-expanded={open}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] text-xs text-white/70 transition-colors"
      >
        <Timer className="w-3.5 h-3.5 text-cyan-400/70" />
        <span className="font-medium">
          {focusMin}/{breakMin}
        </span>
        {current && (
          <span className="text-white/40 hidden sm:inline">· {current.label}</span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={popRef}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-white/[0.08] bg-[#11161E] shadow-2xl shadow-black/60 z-30 overflow-hidden"
            role="menu"
          >
            <div className="p-2 max-h-[60vh] overflow-y-auto">
              <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-white/30">
                Presets
              </p>
              <div className="space-y-0.5">
                {presets.map((p) => {
                  const isCurrent =
                    current && current.id === p.id;
                  return (
                    <div key={p.id} className="group flex items-center">
                      <button
                        onClick={() => handlePick(p)}
                        className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors ${
                          isCurrent
                            ? 'bg-cyan-500/[0.10] text-white'
                            : 'text-white/70 hover:bg-white/[0.04]'
                        }`}
                      >
                        <span className="w-12 font-mono text-xs text-white/55 shrink-0">
                          {p.focus}/{p.break}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="truncate">{p.label}</p>
                          {p.blurb && (
                            <p className="text-[10px] text-white/30 truncate">{p.blurb}</p>
                          )}
                        </div>
                        {isCurrent && <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                      </button>
                      {!p.bundled && (
                        <button
                          onClick={() => handleDeleteCustom(p.id)}
                          aria-label={`Delete ${p.label}`}
                          className="opacity-0 group-hover:opacity-100 p-1.5 text-white/30 hover:text-red-400 transition-all"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add custom */}
              <div className="mt-2 pt-2 border-t border-white/[0.04]">
                {showAdd ? (
                  <div className="space-y-2 p-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={draftLabel}
                        onChange={(e) => setDraftLabel(e.target.value.slice(0, 30))}
                        placeholder="Label (optional)"
                        className="flex-1 px-2.5 py-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] text-xs text-white placeholder:text-white/25 outline-none focus:border-cyan-400/40"
                        maxLength={30}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <DurationField label="Focus" value={draftFocus} setValue={setDraftFocus} max={240} />
                      <DurationField label="Break" value={draftBreak} setValue={setDraftBreak} max={60} />
                      <button
                        onClick={handleSaveCustom}
                        aria-label="Save custom preset"
                        className="p-1.5 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => { setShowAdd(false); setDraftLabel(''); }}
                        aria-label="Cancel"
                        className="p-1.5 rounded-md text-white/40 hover:text-white/70 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAdd(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-white/55 hover:bg-white/[0.04] hover:text-white/85 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add custom preset
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DurationField({
  label,
  value,
  setValue,
  max,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  max: number;
}) {
  return (
    <div className="flex-1">
      <label className="block text-[9px] uppercase tracking-wider text-white/30 mb-0.5">
        {label}
      </label>
      <input
        type="number"
        min={1}
        max={max}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full px-2 py-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] text-xs text-white tabular-nums outline-none focus:border-cyan-400/40"
      />
    </div>
  );
}
