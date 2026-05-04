/**
 * Timer-preset catalog and per-user persistence.
 *
 * Pomodoro orthodoxy is 25/5, but real users have varied research-backed
 * ratios that work better for them:
 *
 *   - 25 / 5  : the classic; safe default
 *   - 50 / 10 : "1.5× classic"; fewer context switches per hour
 *   - 45 / 15 : "deep work"; better for writing/coding sessions
 *   - 90 / 20 : Ultradian rhythm — research shows attention naturally
 *               cycles in ~90-min waves, so this matches our biology
 *   - 15 / 5  : "starter"; the bar is low for momentum-building days
 *
 * The user can pick from these defaults, save their own, or keep the
 * global setting. Presets are persisted in localStorage (per-device
 * preference; doesn't need cloud sync) so the focus-mode switcher
 * loads instantly without waiting on a network round-trip.
 *
 * The active preset MUTATES the existing focus_duration / break_duration
 * settings via updateSettings — we don't introduce a new "currently
 * active preset id" concept. The preset is just a bundle of two
 * settings; switching applies them.
 */

export interface TimerPreset {
  id: string;
  label: string;
  /** Focus minutes. */
  focus: number;
  /** Break minutes. */
  break: number;
  /** Optional one-line rationale shown under the preset in the picker. */
  blurb?: string;
  /** Whether this preset is one of the seeded defaults (vs. user-custom). */
  bundled: boolean;
}

export const BUNDLED_PRESETS: TimerPreset[] = [
  {
    id: 'classic-25-5',
    label: 'Classic',
    focus: 25,
    break: 5,
    blurb: 'The original Pomodoro ratio',
    bundled: true,
  },
  {
    id: 'deep-45-15',
    label: 'Deep work',
    focus: 45,
    break: 15,
    blurb: 'For writing, coding, design',
    bundled: true,
  },
  {
    id: 'long-50-10',
    label: 'Long focus',
    focus: 50,
    break: 10,
    blurb: 'Fewer transitions per hour',
    bundled: true,
  },
  {
    id: 'ultradian-90-20',
    label: 'Ultradian',
    focus: 90,
    break: 20,
    blurb: 'Matches the natural ~90-min attention cycle',
    bundled: true,
  },
  {
    id: 'starter-15-5',
    label: 'Starter',
    focus: 15,
    break: 5,
    blurb: 'Low-bar momentum days',
    bundled: true,
  },
];

const STORAGE_KEY = 'effortos:custom_timer_presets';
const MAX_CUSTOM_PRESETS = 8;

function readCustomPresets(): TimerPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is TimerPreset =>
          p &&
          typeof p.id === 'string' &&
          typeof p.label === 'string' &&
          typeof p.focus === 'number' &&
          typeof p.break === 'number' &&
          p.focus > 0 &&
          p.focus <= 240 &&
          p.break >= 0 &&
          p.break <= 60,
      )
      .map((p) => ({ ...p, bundled: false }));
  } catch {
    return [];
  }
}

function writeCustomPresets(presets: TimerPreset[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(presets.slice(0, MAX_CUSTOM_PRESETS)),
    );
  } catch {
    /* ignore (private mode / quota) */
  }
}

/** Bundled + custom, in display order (bundled first). */
export function getAllPresets(): TimerPreset[] {
  return [...BUNDLED_PRESETS, ...readCustomPresets()];
}

/** Append a new custom preset. Returns the saved row (with id). */
export function saveCustomPreset(label: string, focus: number, breakMin: number): TimerPreset {
  const cleanLabel = label.trim().slice(0, 30) || `${focus}/${breakMin}`;
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const preset: TimerPreset = {
    id,
    label: cleanLabel,
    focus: Math.max(1, Math.min(240, Math.round(focus))),
    break: Math.max(0, Math.min(60, Math.round(breakMin))),
    bundled: false,
  };
  const existing = readCustomPresets();
  const next = [...existing, preset].slice(-MAX_CUSTOM_PRESETS);
  writeCustomPresets(next);
  return preset;
}

/** Delete a custom preset by id. Bundled presets are not deletable. */
export function deleteCustomPreset(id: string): void {
  if (BUNDLED_PRESETS.some((p) => p.id === id)) return;
  const existing = readCustomPresets();
  writeCustomPresets(existing.filter((p) => p.id !== id));
}

/** Find a preset that matches the given focus/break minutes exactly. */
export function findPresetByDurations(focus: number, breakMin: number): TimerPreset | undefined {
  return getAllPresets().find((p) => p.focus === focus && p.break === breakMin);
}
