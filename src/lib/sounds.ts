// Theme-specific sound effects using Web Audio API
// Each theme has unique pomodoro-complete and break-complete sounds

type SoundType = 'pomodoro_complete' | 'break_complete';

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
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

// Sound dispatch map
const THEME_SOUNDS: Record<string, Record<SoundType, (ctx: AudioContext) => void>> = {
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

export function playSound(soundType: SoundType, themeId?: string) {
  try {
    const theme = themeId || (typeof window !== 'undefined' ? localStorage.getItem('effortos_theme') : null) || 'dark';
    const ctx = getAudioContext();
    const themeSounds = THEME_SOUNDS[theme] || THEME_SOUNDS.dark;
    themeSounds[soundType](ctx);
  } catch (e) {
    console.warn('Could not play sound:', e);
  }
}
