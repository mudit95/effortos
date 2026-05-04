/**
 * Server-side Web Push helper.
 *
 * Encodes the encrypted payload according to the Web Push spec
 * (RFC 8291) and POSTs to the user's push service endpoint with a
 * VAPID-signed Authorization header (RFC 8292).
 *
 * Why we don't use the `web-push` npm package:
 *   - It's a Node-runtime-only library (uses native crypto bindings)
 *     and needs explicit configuration to run on Vercel's edge runtime.
 *   - Its surface area is much larger than what we need (we send
 *     plain JSON payloads, not encrypted-content notifications with
 *     custom TTLs / topics).
 *   - We already have access to `crypto.subtle` in the Node runtime
 *     and `crypto.createSign` for VAPID signing — a focused
 *     ~150-line implementation is more auditable than pulling a dep.
 *
 * One subscriber per call. The caller (the cron / API route) loops
 * over all of a user's push_subscriptions rows.
 */

import crypto from 'node:crypto';

interface PushSubscription {
  endpoint: string;
  p256dh: string; // browser's public key (base64url)
  auth: string;   // browser's auth secret (base64url)
}

interface SendResult {
  ok: boolean;
  status: number;
  /** True when the push service reports the subscription is gone (410 / 404).
   *  Caller should DELETE the corresponding push_subscriptions row. */
  expired: boolean;
}

/** ENV: VAPID keys (generated once via `npx web-push generate-vapid-keys`). */
function vapidKeys(): { publicKey: string; privateKey: string; subject: string } {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:hello@effortos.com';
  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set');
  }
  return { publicKey, privateKey, subject };
}

/** Base64url helpers (RFC 4648 §5). */
function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/**
 * Build a VAPID JWT for the push service endpoint's audience.
 * Signed ES256 (P-256 ECDSA). 12-hour expiry per RFC 8292.
 */
function buildVapidAuthHeader(endpoint: string): string {
  const { publicKey, privateKey, subject } = vapidKeys();
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const expSecs = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

  const header = b64urlEncode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    Buffer.from(JSON.stringify({ aud: audience, exp: expSecs, sub: subject })),
  );
  const signingInput = `${header}.${claims}`;

  // Reconstruct the EC private key in PEM form. The VAPID spec uses
  // raw P-256 keys (32-byte private + 65-byte uncompressed public);
  // crypto.createPrivateKey wants PEM, so we wrap the raw scalar +
  // public point into a minimal SEC1 EC private key.
  const privBuf = b64urlDecode(privateKey);
  const pubBuf = b64urlDecode(publicKey);
  if (privBuf.length !== 32) throw new Error('VAPID private key must be 32 bytes');
  if (pubBuf.length !== 65) throw new Error('VAPID public key must be 65 bytes (uncompressed)');

  const sec1Der = Buffer.concat([
    Buffer.from('30770201010420', 'hex'), // SEQUENCE { INTEGER 1, OCTET STRING (32) ...
    privBuf,
    Buffer.from('a00a06082a8648ce3d030107a144034200', 'hex'), // [0] OID secp256r1, [1] BIT STRING ...
    pubBuf,
  ]);
  const pem = `-----BEGIN EC PRIVATE KEY-----\n${sec1Der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END EC PRIVATE KEY-----\n`;
  const keyObj = crypto.createPrivateKey(pem);

  const signer = crypto.createSign('SHA256');
  signer.update(signingInput);
  const derSig = signer.sign({ key: keyObj, dsaEncoding: 'ieee-p1363' });
  // crypto.sign emits IEEE P1363 (raw r||s) when dsaEncoding requested —
  // exactly what JWS ES256 wants.
  const jws = `${signingInput}.${b64urlEncode(derSig)}`;

  return `vapid t=${jws}, k=${publicKey}`;
}

/**
 * Encrypt the payload per RFC 8291 (aes128gcm content encoding).
 * This is the modern Web Push encryption standard, supported by all
 * major browsers as of 2018+. We deliberately don't implement the
 * older aesgcm encoding.
 */
async function encryptPayload(
  subscription: PushSubscription,
  payload: string,
): Promise<{ body: Buffer; salt: Buffer; serverPublicKeyRaw: Buffer }> {
  const plaintext = Buffer.from(payload, 'utf8');

  // Generate a fresh ephemeral EC keypair for this push.
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const serverPublicKeyRaw = ecdh.getPublicKey(); // 65-byte uncompressed
  const sharedSecret = ecdh.computeSecret(b64urlDecode(subscription.p256dh));

  const salt = crypto.randomBytes(16);
  const userAuth = b64urlDecode(subscription.auth);
  const userPublicKey = b64urlDecode(subscription.p256dh);

  // PRK_key = HKDF(IKM=sharedSecret, salt=userAuth, info="WebPush: info\0" || ua_public || as_public, L=32)
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    userPublicKey,
    serverPublicKeyRaw,
  ]);
  const prkKey = hkdfExtract(userAuth, sharedSecret);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);

  // PRK = HKDF(IKM=ikm, salt=salt, info=...) → CEK + NONCE
  const prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0'), 12);

  // Pad with single 0x02 byte (last record marker per RFC 8188).
  const paddedPlaintext = Buffer.concat([plaintext, Buffer.from([0x02])]);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(paddedPlaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([encrypted, authTag]);

  // Build the aes128gcm content block: salt(16) | rs(4 BE) | idlen(1) | keyid | ciphertext
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);
  const idLen = Buffer.from([serverPublicKeyRaw.length]);
  const body = Buffer.concat([salt, recordSize, idLen, serverPublicKeyRaw, ciphertext]);

  return { body, salt, serverPublicKeyRaw };
}

function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return crypto.createHmac('sha256', salt).update(ikm).digest();
}

function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  const hmac = crypto.createHmac('sha256', prk);
  hmac.update(info);
  hmac.update(Buffer.from([0x01]));
  return hmac.digest().subarray(0, length);
}

/**
 * Send a push to a single subscription. Returns ok + status.
 *
 * Payload should be a small JSON object (≤ 4 KB to be safe with
 * Apple Web Push, more on Chrome/Firefox). Title and body are the
 * only two universally-respected fields; we use { title, body, url? }
 * by convention and the service worker handles rendering.
 */
export async function sendWebPush(
  subscription: PushSubscription,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<SendResult> {
  try {
    const { body } = await encryptPayload(subscription, JSON.stringify(payload));
    const auth = buildVapidAuthHeader(subscription.endpoint);

    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        TTL: '86400', // 24 hours; the push service may discard if the device is offline longer
      },
      // Buffer is a Node Uint8Array subclass; TS's fetch types treat
      // SharedArrayBuffer as not-a-BodyInit even though it happily is.
      // The cast unblocks the type-check; runtime is happy with any
      // ArrayBufferView.
      body: new Uint8Array(body) as unknown as BodyInit,
    });

    return {
      ok: res.ok,
      status: res.status,
      expired: res.status === 404 || res.status === 410,
    };
  } catch (e) {
    console.error('[sendWebPush] error:', e);
    return { ok: false, status: 0, expired: false };
  }
}
