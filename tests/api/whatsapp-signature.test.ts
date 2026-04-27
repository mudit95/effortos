/**
 * Coverage for /api/whatsapp/webhook signature verification.
 *
 * Meta's webhook signs every POST with X-Hub-Signature-256 = sha256=HMAC(body, app_secret).
 * The route rejects unsigned/wrongly-signed requests with 401, and the
 * verifier fails CLOSED in production when META_APP_SECRET is missing
 * (a misconfigured prod webhook should never accept anonymous payloads).
 *
 * These tests pin the four cases:
 *   1. Valid signature  → request is accepted (we don't go past signature
 *                          here; we mock downstream deps so the route
 *                          short-circuits at the "phone not recognised" step).
 *   2. Missing signature → 401.
 *   3. Tampered signature → 401.
 *   4. Production + missing secret → 401 (fail closed).
 *
 * We mock every downstream dependency to no-ops so the test exercises only
 * the signature path. None of the mocks need to model real behaviour because
 * a rejected signature returns 401 before any of them are touched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import type { NextRequest } from 'next/server';

const APP_SECRET = 'test_meta_app_secret_aaa';

// ── Mocks ────────────────────────────────────────────────────────────
//
// The route imports a long tail of helpers; we just need them to *exist*
// at import time so the module can load. Since signature failures return
// before any of these are called, no behaviour fidelity is required.

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: null }) }),
      }),
    }),
  }),
}));

vi.mock('@/lib/whatsapp', () => ({
  extractIncomingMessage: () => null,
  sendTextMessage: vi.fn(async () => undefined),
  sendButtonMessage: vi.fn(async () => undefined),
  downloadWhatsAppMedia: vi.fn(async () => null),
}));

vi.mock('@/lib/whatsapp-ai', () => ({
  parseWhatsAppMessage: vi.fn(async () => ({ intent: 'unknown' })),
}));

vi.mock('@/lib/user-date', () => ({
  getUserTimezone: () => 'UTC',
  todayKeyInTz: () => '2026-04-27',
  dateKeyInTz: () => '2026-04-27',
}));

vi.mock('@/lib/whatsapp-state', () => ({
  setPendingFlow: vi.fn(async () => undefined),
  consumePendingFlow: vi.fn(async () => null),
  setTaskList: vi.fn(async () => undefined),
  getTaskList: vi.fn(async () => null),
  checkWhatsappRateLimit: vi.fn(async () => true),
}));

// ── Helpers ──────────────────────────────────────────────────────────

function sign(rawBody: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

async function postWebhook(opts: {
  body: object;
  signature: string | null;
  nodeEnv?: string;
  appSecret?: string | null;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  // Newer Node treats process.env.NODE_ENV as a non-configurable property,
  // so Object.defineProperty trips a TypeError. vi.stubEnv routes around
  // this by patching at the vitest layer, and it's auto-restored after
  // each test via vi.unstubAllEnvs() (we call it in afterEach below).
  if (opts.nodeEnv !== undefined) {
    vi.stubEnv('NODE_ENV', opts.nodeEnv);
  }
  if (opts.appSecret === null) {
    // stubEnv with empty string maps to "unset" for our verifier — the route
    // only checks truthiness of process.env.META_APP_SECRET.
    vi.stubEnv('META_APP_SECRET', '');
  } else if (opts.appSecret !== undefined) {
    vi.stubEnv('META_APP_SECRET', opts.appSecret);
  }

  vi.resetModules();
  const mod = await import('@/app/api/whatsapp/webhook/route');
  const rawBody = JSON.stringify(opts.body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.signature !== null) headers['x-hub-signature-256'] = opts.signature;
  const req = new Request('http://test/api/whatsapp/webhook', {
    method: 'POST',
    headers,
    body: rawBody,
  });
  // The route is typed against NextRequest but accepts plain Request at runtime.
  const res = await mod.POST(req as unknown as NextRequest);
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: data };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('/api/whatsapp/webhook — signature verification', () => {
  beforeEach(() => {
    process.env.META_APP_SECRET = APP_SECRET;
  });

  afterEach(() => {
    // Reverses every vi.stubEnv() call from the prior test, restoring the
    // real process.env values. Without this, NODE_ENV bleeds across tests.
    vi.unstubAllEnvs();
  });

  it('rejects request with missing signature header (401)', async () => {
    const body = { entry: [] };
    const { status, body: resp } = await postWebhook({
      body,
      signature: null,
      nodeEnv: 'production',
    });
    expect(status).toBe(401);
    expect(resp.error).toMatch(/invalid signature/i);
  });

  it('rejects request with wrong signature (401)', async () => {
    const body = { entry: [] };
    const tamperedSig = sign(JSON.stringify(body), 'WRONG_SECRET');
    const { status, body: resp } = await postWebhook({
      body,
      signature: tamperedSig,
      nodeEnv: 'production',
    });
    expect(status).toBe(401);
    expect(resp.error).toMatch(/invalid signature/i);
  });

  it('rejects request with mismatched-length signature (401)', async () => {
    const body = { entry: [] };
    // Truncated signature — the timing-safe compare bails on length first.
    const sig = 'sha256=abc123';
    const { status } = await postWebhook({
      body,
      signature: sig,
      nodeEnv: 'production',
    });
    expect(status).toBe(401);
  });

  it('fails CLOSED in production when META_APP_SECRET is missing (401)', async () => {
    const body = { entry: [] };
    // Even with a "signature" present, the verifier returns false before
    // attempting any HMAC compare when the secret is unset in production.
    const { status, body: resp } = await postWebhook({
      body,
      signature: 'sha256=anything',
      nodeEnv: 'production',
      appSecret: null,
    });
    expect(status).toBe(401);
    expect(resp.error).toMatch(/invalid signature/i);
  });

  it('fails OPEN in non-production when META_APP_SECRET is missing (200)', async () => {
    const body = { entry: [] };
    const { status } = await postWebhook({
      body,
      signature: null,
      nodeEnv: 'development',
      appSecret: null,
    });
    // No signature, no secret, dev env → verifier returns true. Body is empty
    // so extractIncomingMessage returns null and the route ack's with 200.
    expect(status).toBe(200);
  });

  it('accepts a correctly-signed body (does not 401)', async () => {
    const body = { entry: [] };
    const rawBody = JSON.stringify(body);
    const sig = sign(rawBody, APP_SECRET);
    const { status } = await postWebhook({
      body,
      signature: sig,
      nodeEnv: 'production',
    });
    // Empty body → extractIncomingMessage returns null → route returns 200 ok.
    // The important assertion is that we did NOT 401 — i.e. signature passed.
    expect(status).toBe(200);
  });
});
