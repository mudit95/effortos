// Web Worker for reliable timer
// Survives tab switches, throttling, and background

let interval = null;
let remaining = 0;
let isRunning = false;

self.onmessage = function(e) {
  const { type, payload } = e.data;

  switch (type) {
    case 'START':
      remaining = payload.duration;
      isRunning = true;
      if (interval) clearInterval(interval);
      interval = setInterval(() => {
        if (!isRunning) return;
        remaining--;
        self.postMessage({ type: 'TICK', remaining });
        if (remaining <= 0) {
          isRunning = false;
          clearInterval(interval);
          interval = null;
          self.postMessage({ type: 'COMPLETE' });
        }
      }, 1000);
      break;

    case 'PAUSE':
      isRunning = false;
      break;

    case 'RESUME':
      isRunning = true;
      break;

    case 'STOP':
      isRunning = false;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      remaining = 0;
      break;

    case 'SYNC':
      self.postMessage({ type: 'SYNC_RESPONSE', remaining, isRunning });
      break;
  }
};
