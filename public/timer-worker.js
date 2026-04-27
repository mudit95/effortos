// Web Worker for reliable timer.
// Timestamp-based: drift-free under tab throttling, no bursts on un-throttle.
//
// Why timestamp-based instead of decrement-based?
//   The previous implementation did `remaining--` every setInterval(1000) tick.
//   Browsers throttle background-tab workers (Chrome clamps to 1 Hz, can stall
//   entirely on aggressive battery saver). When the interval stalled, the timer
//   appeared to pause; when it un-throttled, queued callbacks fired in rapid
//   succession and the counter "burst" forward several seconds.
//
//   This rewrite stores `endsAt` as a wall-clock timestamp. Each tick
//   recomputes remaining from Date.now(), so:
//     - Throttle has no effect on accuracy — we just emit fewer TICKs.
//     - Un-throttle never bursts the counter; remaining is always real-time.
//     - Tick frequency (250ms) catches un-throttle quickly, but TICK is
//       only emitted when the integer-second value changes.

let interval = null;
let endsAt = 0;          // Wall-clock ms when the countdown reaches zero.
let pausedRemaining = 0; // Captured at PAUSE so RESUME is exact.
let isRunning = false;
let lastEmitted = -1;    // Last integer-second we emitted (-1 forces first emit).

/** Integer seconds remaining, floor at zero. */
function computeRemaining() {
  return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
}

/** Tick callback — emits TICK only when integer-second changes, COMPLETE on zero. */
function tick() {
  if (!isRunning) return;
  const remaining = computeRemaining();
  if (remaining !== lastEmitted) {
    lastEmitted = remaining;
    self.postMessage({ type: 'TICK', remaining });
  }
  if (remaining === 0) {
    isRunning = false;
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    self.postMessage({ type: 'COMPLETE' });
  }
}

/** Begin a countdown for `durationSec` seconds, starting now. */
function startCountdown(durationSec) {
  endsAt = Date.now() + durationSec * 1000;
  isRunning = true;
  lastEmitted = -1;
  if (interval) clearInterval(interval);
  // 250ms — frequent enough that un-throttle catches up within ~250ms,
  // not so frequent we flood the message channel.
  interval = setInterval(tick, 250);
  tick(); // immediate first emit
}

self.onmessage = function (e) {
  const { type, payload } = e.data;
  switch (type) {
    case 'START':
      startCountdown(payload.duration);
      break;

    case 'PAUSE':
      if (isRunning) {
        pausedRemaining = computeRemaining();
        isRunning = false;
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      }
      break;

    case 'RESUME':
      if (!isRunning && pausedRemaining > 0) {
        startCountdown(pausedRemaining);
        pausedRemaining = 0;
      }
      break;

    case 'STOP':
      isRunning = false;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      endsAt = 0;
      pausedRemaining = 0;
      lastEmitted = -1;
      break;

    case 'SYNC': {
      const remaining = isRunning ? computeRemaining() : pausedRemaining;
      self.postMessage({ type: 'SYNC_RESPONSE', remaining, isRunning });
      break;
    }
  }
};
