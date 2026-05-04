// Theme-specific sound effects using Web Audio API
// Each theme has unique pomodoro-complete and break-complete sounds.
//
// Sound types:
//   pomodoro_complete   — focus session finished (full chime)
//   break_complete      — break finished (lighter chime)
//   session_start       — quick "play" tick when user starts/resumes (subtle)
//   session_pause       — quick "pause" tick when user pauses (subtle)
//
// Start/pause are kept very short (~150 ms) and quiet so they read as
// haptic feedback rather than music. They're not theme-skinned because
// users would notice the inconsistency between subtle UI ticks more than
// they'd appreciate the variety.

type SoundType = 'pomodoro_complete' | 'break_complete' | 'session_start' | 'session_pause';

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext();
  }
  // Force-resume suspended contexts. Browsers suspend AudioContext when
  // it was created outside a user gesture. The resume() call here is
  // wrapped in a try/catch because some browsers throw if the context
  // is in an unexpected state.
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

/**
 * Force-resume the AudioContext if it exists and is suspended.
 *
 * Mobile browsers suspend the AudioContext whenever the tab is
 * backgrounded. Sounds scheduled while suspended don't play — we'd
 * silently lose the session-complete chime fired from the worker
 * COMPLETE handler. The timer-lifecycle hook calls this on every
 * visibilitychange-to-visible so any subsequent playSound finds an
 * awake context.
 *
 * Returns a promise that resolves once the context is running (or
 * immediately if no context exists yet — first-gesture creation
 * still happens via warmUpAudio).
 */
export async function resumeAudioContext(): Promise<void> {
  if (!audioContext) return;
  if (audioContext.state !== 'suspended') return;
  try {
    await audioContext.resume();
  } catch {
    /* iOS sometimes throws when called outside a gesture; the next
     *  gesture will resume it. */
  }
}

/**
 * Warm up the AudioContext on any user interaction so that later
 * programmatic calls to playSound() (e.g., from a timer complete
 * callback) don't get blocked by the browser's autoplay policy.
 *
 * Call once at app startup. Attaches lightweight one-shot listeners
 * that create the context on the first click/keydown/touch.
 */
export function warmUpAudio() {
  if (typeof window === 'undefined') return;
  const warm = () => {
    getAudioContext();
    window.removeEventListener('click', warm);
    window.removeEventListener('keydown', warm);
    window.removeEventListener('touchstart', warm);
  };
  window.addEventListener('click', warm, { once: true });
  window.addEventListener('keydown', warm, { once: true });
  window.addEventListener('touchstart', warm, { once: true });
}

function playNote(
  ctx: AudioContext,
  frequency: number,
  startTime: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume: number = 0.3,
  detune: number = 0
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startTime);
  if (detune) osc.detune.setValueAtTime(detune, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

// --- DARK theme: clean digital chime (ascending triad) ---
function darkPomodoroComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  playNote(ctx, 523.25, t, 0.3, 'sine', 0.25);        // C5
  playNote(ctx, 659.25, t + 0.12, 0.3, 'sine', 0.25);  // E5
  playNote(ctx, 783.99, t + 0.24, 0.5, 'sine', 0.3);   // G5
}

function darkBreakComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  playNote(ctx, 440, t, 0.25, 'sine', 0.2);        // A4
  playNote(ctx, 523.25, t + 0.15, 0.35, 'sine', 0.25); // C5
}

// --- NEON theme: synthy retro blips ---
function neonPomodoroComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  playNote(ctx, 880, t, 0.15, 'square', 0.15);
  playNote(ctx, 1108.73, t + 0.1, 0.15, 'square', 0.15);
  playNote(ctx, 1318.51, t + 0.2, 0.15, 'square', 0.15);
  playNote(ctx, 1760, t + 0.3, 0.4, 'square', 0.12);
}

function neonBreakComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  playNote(ctx, 660, t, 0.12, 'square', 0.12);
  playNote(ctx, 880, t + 0.1, 0.2, 'square', 0.12);
}

// --- LIGHT theme: gentle marimba-like tones ---
function lightPomodoroComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  playNote(ctx, 698.46, t, 0.4, 'triangle', 0.3);       // F5
  playNote(ctx, 880, t + 0.15, 0.4, 'triangle', 0.3);    // A5
  playNote(ctx, 1046.5, t + 0.3, 0.6, 'triangle', 0.25); // C6
}

function lightBreakComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  playNote(ctx, 523.25, t, 0.3, 'triangle', 0.25);  // C5
  playNote(ctx, 659.25, t + 0.2, 0.4, 'triangle', 0.25); // E5
}

// --- NIGHT theme: deep mellow bell ---
function nightPomodoroComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  playNote(ctx, 261.63, t, 0.6, 'sine', 0.25);       // C4
  playNote(ctx, 329.63, t + 0.2, 0.6, 'sine', 0.2);   // E4
  playNote(ctx, 392, t + 0.4, 0.8, 'sine', 0.25);     // G4
  playNote(ctx, 523.25, t + 0.6, 1.0, 'sine', 0.2);   // C5
}

function nightBreakComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  playNote(ctx, 220, t, 0.5, 'sine', 0.2);    // A3
  playNote(ctx, 329.63, t + 0.25, 0.6, 'sine', 0.2); // E4
}

// --- DAY theme: bright cheerful arpeggio ---
function dayPomodoroComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  playNote(ctx, 587.33, t, 0.2, 'triangle', 0.3);       // D5
  playNote(ctx, 739.99, t + 0.08, 0.2, 'triangle', 0.3); // F#5
  playNote(ctx, 880, t + 0.16, 0.2, 'triangle', 0.3);    // A5
  playNote(ctx, 1174.66, t + 0.24, 0.5, 'triangle', 0.25); // D6
}

function dayBreakComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  playNote(ctx, 493.88, t, 0.2, 'triangle', 0.25);  // B4
  playNote(ctx, 587.33, t + 0.12, 0.3, 'triangle', 0.25); // D5
}

// --- LANDSCAPE theme: organic earthy tones (wind chime feel) ---
function landscapePomodoroComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  playNote(ctx, 392, t, 0.5, 'sine', 0.2);          // G4
  playNote(ctx, 493.88, t + 0.18, 0.5, 'sine', 0.2);  // B4
  playNote(ctx, 587.33, t + 0.36, 0.6, 'sine', 0.25); // D5
  // Add slight shimmer
  playNote(ctx, 784, t + 0.36, 0.8, 'sine', 0.08);
}

function landscapeBreakComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  playNote(ctx, 349.23, t, 0.4, 'sine', 0.2);    // F4
  playNote(ctx, 440, t + 0.2, 0.5, 'sine', 0.2); // A4
}

// --- GALLERY theme: dramatic artistic flourish ---
function galleryPomodoroComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  playNote(ctx, 440, t, 0.3, 'sawtooth', 0.1);
  playNote(ctx, 554.37, t + 0.1, 0.3, 'sawtooth', 0.1);  // C#5
  playNote(ctx, 659.25, t + 0.2, 0.3, 'sawtooth', 0.1);   // E5
  playNote(ctx, 880, t + 0.35, 0.6, 'sine', 0.2);          // A5
}

function galleryBreakComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  playNote(ctx, 369.99, t, 0.3, 'sawtooth', 0.08); // F#4
  playNote(ctx, 440, t + 0.15, 0.4, 'sine', 0.15);  // A4
}

// --- OCEAN theme: flowing wave-like tones ---
function oceanPomodoroComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  // Flowing ascending notes with slight overlap
  playNote(ctx, 293.66, t, 0.5, 'sine', 0.2);         // D4
  playNote(ctx, 369.99, t + 0.15, 0.5, 'sine', 0.2);   // F#4
  playNote(ctx, 440, t + 0.3, 0.5, 'sine', 0.25);      // A4
  playNote(ctx, 554.37, t + 0.45, 0.7, 'sine', 0.2);   // C#5
  // Subtle high shimmer
  playNote(ctx, 880, t + 0.45, 0.9, 'sine', 0.06);
}

function oceanBreakComplete(ctx: AudioContext) {
  const t = ctx.currentTime;
  playNote(ctx, 329.63, t, 0.4, 'sine', 0.2);    // E4
  playNote(ctx, 392, t + 0.2, 0.5, 'sine', 0.2); // G4
  playNote(ctx, 493.88, t + 0.4, 0.4, 'sine', 0.15); // B4
}

// Sound dispatch map. Only the theme-skinned types live here — universal
// ticks (session_start, session_pause) are dispatched separately in
// playSound() and don't vary by theme.
type ThemedSoundType = 'pomodoro_complete' | 'break_complete';
const THEME_SOUNDS: Record<string, Record<ThemedSoundType, (ctx: AudioContext) => void>> = {
  dark: {
    pomodoro_complete: darkPomodoroComplete,
    break_complete: darkBreakComplete,
  },
  neon: {
    pomodoro_complete: neonPomodoroComplete,
    break_complete: neonBreakComplete,
  },
  light: {
    pomodoro_complete: lightPomodoroComplete,
    break_complete: lightBreakComplete,
  },
  night: {
    pomodoro_complete: nightPomodoroComplete,
    break_complete: nightBreakComplete,
  },
  day: {
    pomodoro_complete: dayPomodoroComplete,
    break_complete: dayBreakComplete,
  },
  landscape: {
    pomodoro_complete: landscapePomodoroComplete,
    break_complete: landscapeBreakComplete,
  },
  gallery: {
    pomodoro_complete: galleryPomodoroComplete,
    break_complete: galleryBreakComplete,
  },
  ocean: {
    pomodoro_complete: oceanPomodoroComplete,
    break_complete: oceanBreakComplete,
  },
};

// ── Universal session start / pause ticks ──────────────────────────────
//
// These two are not theme-skinned — they're tiny UI ticks (~150 ms) so
// the user gets immediate feedback when they hit play / pause. Volume is
// kept low (0.12) so they don't feel like the bigger complete chimes.
function sessionStartTick(ctx: AudioContext) {
  const t = ctx.currentTime;
  // Quick ascending two-note blip — reads as "go".
  playNote(ctx, 587.33, t, 0.08, 'sine', 0.12);          // D5
  playNote(ctx, 880, t + 0.07, 0.12, 'sine', 0.12);      // A5
}

function sessionPauseTick(ctx: AudioContext) {
  const t = ctx.currentTime;
  // Quick descending two-note blip — reads as "stop".
  playNote(ctx, 880, t, 0.08, 'sine', 0.10);             // A5
  playNote(ctx, 587.33, t + 0.07, 0.12, 'sine', 0.10);   // D5
}

export function playSound(soundType: SoundType, themeId?: string) {
  try {
    const ctx = getAudioContext();
    // Browsers sometimes leave the context "suspended" even after creation;
    // we resume defensively here too. The promise is fire-and-forget — if
    // the resume genuinely fails (no user gesture has fired yet) the
    // schedule below will still queue a buffer that plays once the
    // context wakes up on a later interaction.
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    // Universal ticks bypass the theme map.
    if (soundType === 'session_start') {
      sessionStartTick(ctx);
      return;
    }
    if (soundType === 'session_pause') {
      sessionPauseTick(ctx);
      return;
    }
    const theme = themeId || (typeof window !== 'undefined' ? localStorage.getItem('effortos_theme') : null) || 'dark';
    const themeSounds = THEME_SOUNDS[theme] || THEME_SOUNDS.dark;
    themeSounds[soundType](ctx);
  } catch (e) {
    console.warn('Could not play sound:', e);
  }
}
