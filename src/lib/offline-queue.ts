/**
 * Offline-resilient sync queue.
 *
 * Stores failed API calls in IndexedDB and replays them when
 * connectivity returns. This prevents "my session didn't count"
 * moments when a user completes a pomodoro while offline.
 *
 * Usage:
 *   import { enqueueOffline, flushOfflineQueue } from '@/lib/offline-queue';
 *
 *   // Wrap any API call:
 *   try {
 *     await api.completeSession(id, duration);
 *   } catch (err) {
 *     if (!navigator.onLine) {
 *       enqueueOffline({ url: '/api/sessions/complete', method: 'POST', body: { ... } });
 *     }
 *   }
 *
 *   // On app load or when going online:
 *   flushOfflineQueue();
 */

const DB_NAME = 'effortos_offline';
const STORE_NAME = 'sync_queue';
const DB_VERSION = 1;

export interface QueuedRequest {
  id?: number; // auto-increment key
  url: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body: Record<string, unknown>;
  timestamp: number;
  retries: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Add a failed request to the offline queue. */
export async function enqueueOffline(request: Omit<QueuedRequest, 'id' | 'timestamp' | 'retries'>): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add({
      ...request,
      timestamp: Date.now(),
      retries: 0,
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[OfflineQueue] Failed to enqueue:', err);
  }
}

/** Get all queued requests, oldest first. */
async function getAll(): Promise<QueuedRequest[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    return [];
  }
}

/** Remove a single item by its auto-increment key. */
async function remove(id: number): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {}
}

/** Increment retry counter for a queued item. */
async function incrementRetry(id: number): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      if (req.result) {
        req.result.retries += 1;
        store.put(req.result);
      }
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {}
}

const MAX_RETRIES = 5;

/**
 * Replay all queued requests. Called on app load and when
 * connectivity is restored. Processes sequentially to maintain
 * ordering (important for session → goal progress updates).
 */
export async function flushOfflineQueue(): Promise<{ replayed: number; failed: number }> {
  if (typeof window === 'undefined') return { replayed: 0, failed: 0 };
  if (!navigator.onLine) return { replayed: 0, failed: 0 };

  const items = await getAll();
  if (items.length === 0) return { replayed: 0, failed: 0 };

  let replayed = 0;
  let failed = 0;

  for (const item of items) {
    if (item.retries >= MAX_RETRIES) {
      // Give up after MAX_RETRIES — remove stale item
      await remove(item.id!);
      failed++;
      continue;
    }

    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.body),
      });

      if (res.ok || res.status === 409) {
        // 409 = already processed (idempotent), treat as success
        await remove(item.id!);
        replayed++;
      } else if (res.status >= 400 && res.status < 500) {
        // Client error — no point retrying
        await remove(item.id!);
        failed++;
      } else {
        // Server error — retry later
        await incrementRetry(item.id!);
        failed++;
      }
    } catch {
      // Network error — stop trying for now
      await incrementRetry(item.id!);
      failed++;
      break; // Still offline, stop processing
    }
  }

  if (replayed > 0) {
    console.log(`[OfflineQueue] Replayed ${replayed} queued request(s)`);
  }

  return { replayed, failed };
}

/** Number of items waiting in the queue. */
export async function queueSize(): Promise<number> {
  const items = await getAll();
  return items.length;
}

/**
 * Set up automatic flush on connectivity restore.
 * Call once at app initialization.
 */
export function initOfflineSync(): void {
  if (typeof window === 'undefined') return;

  // Flush on app load (in case we have leftover items from last session)
  flushOfflineQueue();

  // Flush whenever we come back online
  window.addEventListener('online', () => {
    console.log('[OfflineQueue] Back online — flushing queue');
    flushOfflineQueue();
  });
}
