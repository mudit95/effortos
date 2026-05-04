/**
 * Browser-side helper for the Web Push subscription dance.
 *
 * Two responsibilities:
 *   1. Determine whether push is available + already subscribed.
 *   2. Subscribe (asks for permission, calls pushManager.subscribe,
 *      POSTs the result to /api/push/subscribe).
 *
 * Notes on UX:
 *   - We DO NOT ask for permission on app load. That's the spammy
 *     pattern that gets users to permanently deny. The caller decides
 *     when to call ensureSubscribed() — typically on first session
 *     start, when the value-for-permission ratio is highest.
 *   - We surface a one-line user-friendly message via the toast
 *     system on success/failure (toast handler injected by caller).
 *   - VAPID public key comes from NEXT_PUBLIC_VAPID_PUBLIC_KEY (set
 *     at build time on Vercel; same value as VAPID_PUBLIC_KEY).
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

export interface PushAvailability {
  /** Browser supports Web Push at all (PushManager exists). */
  supported: boolean;
  /** Permission state: 'granted' | 'denied' | 'default'. */
  permission: NotificationPermission | 'unsupported';
  /** True if we already have a working subscription saved on this device. */
  subscribed: boolean;
}

/** Convert URL-safe base64 to a Uint8Array for applicationServerKey. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const b64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function getPushAvailability(): Promise<PushAvailability> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return { supported: false, permission: 'unsupported', subscribed: false };
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: !!sub,
  };
}

/**
 * Ensure the current device has an active push subscription saved
 * server-side. If not, request permission + subscribe + persist.
 *
 * Returns true on success (already subscribed OR successfully
 * subscribed in this call). Returns false on any failure (denied,
 * unsupported, network error). Caller decides what to do on false
 * — usually nothing (silent degradation to in-page notifications).
 */
export async function ensureSubscribed(): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY) {
    // Build-time env not set. Don't pop a permission prompt that
    // would lead nowhere.
    return false;
  }
  const avail = await getPushAvailability();
  if (!avail.supported) return false;
  if (avail.permission === 'denied') return false;

  // Request permission only if not granted yet. permission === 'default'
  // is the only state that prompts; 'granted' / 'denied' don't.
  if (avail.permission !== 'granted') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') return false;
  }

  // Get or create subscription.
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast to BufferSource — TS's Uint8Array is generic over the
        // underlying buffer (ArrayBuffer | SharedArrayBuffer) but
        // pushManager.subscribe wants a concrete ArrayBuffer-backed
        // view. The cast is safe: urlBase64ToUint8Array allocates
        // its own backing ArrayBuffer.
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    } catch (e) {
      console.error('[ensureSubscribed] subscribe failed:', e);
      return false;
    }
  }

  // POST to server.
  try {
    const subJson = sub.toJSON();
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: subJson,
        userAgent: navigator.userAgent,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error('[ensureSubscribed] /api/push/subscribe failed:', e);
    return false;
  }
}

/**
 * Detach the current device's subscription from both the push
 * service AND our server. Returns true on success.
 */
export async function unsubscribe(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return true;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  try {
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    /* server cleanup will catch via 410 on next send */
  }
  return true;
}
