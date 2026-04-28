import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { Redis } from '@upstash/redis';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendTextMessage } from '@/lib/whatsapp';
import { buildWelcomeMessage, resolvePersona } from '@/lib/whatsapp-welcome';
import type { BotPersona } from '@/types';

// ── OTP storage ──────────────────────────────────────────────
// Primary: Upstash Redis — survives cold starts on Vercel's
// per-invocation serverless runtime. Fallback: in-process Map for
// local dev without Upstash env vars. The Map is intentionally
// unreliable in serverless (each Lambda has its own copy), but the
// Redis path handles prod.
type OtpRecord = { code: string; userId: string; expiresAt: number; attempts: number };

const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_MS = 60 * 1000; // 1 OTP per phone per minute

let _redis: Redis | null | undefined; // undefined = not yet computed; null = unavailable
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    _redis = null;
    return null;
  }
  try {
    _redis = new Redis({ url, token });
  } catch {
    _redis = null;
  }
  return _redis;
}

// Dev-only in-memory fallback. Guarded — only used when Redis is unavailable.
const devOtpStore = new Map<string, OtpRecord>();
const devRlStore = new Map<string, number>();

function otpKey(phone: string) { return `otp:wa:${phone}`; }
function rlKey(phone: string) { return `otp:wa:rl:${phone}`; }

async function otpGet(phone: string): Promise<OtpRecord | null> {
  const r = getRedis();
  if (r) {
    const v = await r.get<OtpRecord | string>(otpKey(phone));
    if (!v) return null;
    // Upstash returns objects as JSON when set with an object; if someone
    // set a raw string by accident, parse defensively.
    if (typeof v === 'string') {
      try { return JSON.parse(v) as OtpRecord; } catch { return null; }
    }
    return v as OtpRecord;
  }
  return devOtpStore.get(phone) ?? null;
}

async function otpSet(phone: string, rec: OtpRecord): Promise<void> {
  const r = getRedis();
  if (r) {
    const ttlSec = Math.max(1, Math.ceil((rec.expiresAt - Date.now()) / 1000));
    await r.set(otpKey(phone), rec, { ex: ttlSec });
    return;
  }
  devOtpStore.set(phone, rec);
}

async function otpDel(phone: string): Promise<void> {
  const r = getRedis();
  if (r) { await r.del(otpKey(phone)); return; }
  devOtpStore.delete(phone);
}

/** Returns seconds remaining if throttled, else null. Also records a fresh timestamp on success. */
async function sendRateLimitCheck(phone: string): Promise<number | null> {
  const r = getRedis();
  if (r) {
    const last = await r.get<number>(rlKey(phone));
    if (last && Date.now() - last < RATE_LIMIT_MS) {
      return Math.ceil((RATE_LIMIT_MS - (Date.now() - last)) / 1000);
    }
    await r.set(rlKey(phone), Date.now(), { ex: Math.ceil(RATE_LIMIT_MS / 1000) });
    return null;
  }
  const last = devRlStore.get(phone);
  if (last && Date.now() - last < RATE_LIMIT_MS) {
    return Math.ceil((RATE_LIMIT_MS - (Date.now() - last)) / 1000);
  }
  devRlStore.set(phone, Date.now());
  return null;
}

/**
 * Cryptographically secure 6-digit OTP. `crypto.randomInt` uses the OS
 * CSPRNG, so values are not predictable from one another (unlike
 * `Math.random`, which is a seeded PRNG).
 */
function generateOTP(): string {
  // randomInt(min, max) is [min, max); we want 000000..999999 inclusive.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * POST /api/whatsapp/verify
 * Body: { action: "send" | "confirm", phone: string, code?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action, phone, code, persona } = body;

    if (!phone || typeof phone !== 'string') {
      return NextResponse.json({ error: 'Phone number required' }, { status: 400 });
    }

    // Validate persona if supplied. We accept undefined (caller didn't
    // pick one — defaults to 'friend' downstream) but reject anything
    // that isn't a known value, so the DB CHECK constraint never trips.
    const allowedPersonas: BotPersona[] = ['friend', 'mentor', 'boss', 'colleague'];
    let confirmedPersona: BotPersona | undefined;
    if (persona !== undefined && persona !== null && persona !== '') {
      if (typeof persona !== 'string' || !allowedPersonas.includes(persona as BotPersona)) {
        return NextResponse.json({ error: 'Invalid persona' }, { status: 400 });
      }
      confirmedPersona = persona as BotPersona;
    }

    // Normalize: strip spaces, ensure starts with +
    const cleanPhone = phone.replace(/\s/g, '');
    if (!/^\+[1-9]\d{6,14}$/.test(cleanPhone)) {
      return NextResponse.json(
        { error: 'Invalid phone number. Use E.164 format (e.g. +919876543210)' },
        { status: 400 },
      );
    }

    // The WhatsApp API expects the number without the leading +
    const waNumber = cleanPhone.replace('+', '');

    if (action === 'send') {
      return await handleSendOTP(user.id, cleanPhone, waNumber);
    } else if (action === 'confirm') {
      if (!code || typeof code !== 'string') {
        return NextResponse.json({ error: 'OTP code required' }, { status: 400 });
      }
      return await handleConfirmOTP(user.id, cleanPhone, code.trim(), confirmedPersona);
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (err) {
    console.error('WhatsApp verify error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

async function handleSendOTP(userId: string, phone: string, waNumber: string) {
  // Rate limit: max 1 OTP per phone per minute
  const waitSecs = await sendRateLimitCheck(phone);
  if (waitSecs !== null) {
    return NextResponse.json(
      { error: `Please wait ${waitSecs}s before requesting another code` },
      { status: 429 },
    );
  }

  // Check if this phone is already linked to another user
  const serviceClient = createServiceClient();
  const { data: existing } = await serviceClient
    .from('profiles')
    .select('id')
    .eq('phone_number', phone)
    .neq('id', userId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: 'This number is already linked to another account' },
      { status: 409 },
    );
  }

  // Generate and store OTP
  const otp = generateOTP();
  await otpSet(phone, {
    code: otp,
    userId,
    expiresAt: Date.now() + OTP_EXPIRY_MS,
    attempts: 0,
  });

  // Send OTP via WhatsApp
  await sendTextMessage(
    waNumber,
    `🔐 Your EffortOS verification code is: *${otp}*\n\nThis code expires in 5 minutes. If you didn't request this, ignore this message.`,
  );

  return NextResponse.json({ sent: true, expiresIn: OTP_EXPIRY_MS / 1000 });
}

/** Timing-safe 6-digit code compare — the codes are short but we still
 * avoid comparison side channels for good hygiene. */
function safeEqualOtp(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  try { return crypto.timingSafeEqual(aBuf, bBuf); } catch { return false; }
}

async function handleConfirmOTP(
  userId: string,
  phone: string,
  code: string,
  persona?: BotPersona,
) {
  const entry = await otpGet(phone);

  if (!entry) {
    return NextResponse.json(
      { error: 'No verification code found. Please request a new one.' },
      { status: 400 },
    );
  }

  // Check expiry
  if (Date.now() > entry.expiresAt) {
    await otpDel(phone);
    return NextResponse.json(
      { error: 'Code expired. Please request a new one.' },
      { status: 400 },
    );
  }

  // Check if this OTP belongs to the requesting user
  if (entry.userId !== userId) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 403 });
  }

  // Check attempts
  if (entry.attempts >= MAX_ATTEMPTS) {
    await otpDel(phone);
    return NextResponse.json(
      { error: 'Too many attempts. Please request a new code.' },
      { status: 429 },
    );
  }

  // Verify code
  if (!safeEqualOtp(entry.code, code)) {
    const updated: OtpRecord = { ...entry, attempts: entry.attempts + 1 };
    await otpSet(phone, updated);
    const remaining = MAX_ATTEMPTS - updated.attempts;
    return NextResponse.json(
      { error: `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` },
      { status: 400 },
    );
  }

  // OTP verified — link phone to profile.
  //
  // NOTE: Delete OTP AFTER successful DB write (not before) to avoid race condition.
  //
  // Persona handling: if the caller passed a persona (i.e. came from
  // onboarding where they just picked one), persist it alongside the
  // phone link so the welcome message — and every subsequent coach
  // reply — uses that voice. If no persona is supplied (e.g. user is
  // re-linking from Settings without changing voice) we leave whatever
  // is on the profile alone.
  const serviceClient = createServiceClient();
  const linkUpdate: Record<string, unknown> = {
    phone_number: phone,
    whatsapp_linked: true,
  };
  if (persona) {
    linkUpdate.bot_persona = persona;
  }
  const { error: dbError } = await serviceClient
    .from('profiles')
    .update(linkUpdate)
    .eq('id', userId);

  if (dbError) {
    console.error('Failed to link phone:', dbError);
    return NextResponse.json({ error: 'Failed to save. Try again.' }, { status: 500 });
  }

  // DB update succeeded — now safe to clear OTP
  await otpDel(phone);

  // Pull name, active-goal title, and persona to compose the welcome
  // message. Best-effort: if any lookup fails we still send a useful
  // greeting, just without the personalised touches. Failure here must
  // NOT block the verify response — the link itself succeeded above.
  let firstName = 'friend';
  let activeGoalTitle: string | null = null;
  let resolvedPersona = resolvePersona(persona);
  try {
    const [{ data: profile }, { data: goal }] = await Promise.all([
      serviceClient
        .from('profiles')
        .select('display_name, bot_persona')
        .eq('id', userId)
        .maybeSingle(),
      serviceClient
        .from('goals')
        .select('title')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (profile?.display_name) {
      // Use only the first word — feels conversational on WhatsApp
      // ("Hey Mudit" vs the more formal "Hey Mudit Mohilay").
      firstName = profile.display_name.trim().split(/\s+/)[0] || 'friend';
    }
    if (goal?.title) {
      activeGoalTitle = goal.title;
    }
    // If we didn't get persona from the request body (re-linking from
    // Settings) read whatever is currently on the profile so the voice
    // stays consistent across re-links.
    if (!persona && profile?.bot_persona) {
      resolvedPersona = resolvePersona(profile.bot_persona);
    }
  } catch (err) {
    console.error('[whatsapp/verify] welcome-message profile/goal lookup failed:', err);
  }

  // Send the welcome message via WhatsApp. The body varies by persona —
  // see lib/whatsapp-welcome.ts for the four voices.
  const waNumber = phone.replace('+', '');
  await sendTextMessage(
    waNumber,
    buildWelcomeMessage({
      firstName,
      goalTitle: activeGoalTitle,
      persona: resolvedPersona,
    }),
  );

  return NextResponse.json({ verified: true, persona: resolvedPersona });
}
