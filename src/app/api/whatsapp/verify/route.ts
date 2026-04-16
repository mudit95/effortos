import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendTextMessage } from '@/lib/whatsapp';

// ── In-memory OTP store ──
// Maps phone number → { code, userId, expiresAt, attempts }
// In production you'd use Redis or a DB table, but for MVP this works.
const otpStore = new Map<
  string,
  { code: string; userId: string; expiresAt: number; attempts: number }
>();

const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_MS = 60 * 1000; // 1 OTP per phone per minute

// Rate limit: track last send time per phone
const sendRateLimit = new Map<string, number>();

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * POST /api/whatsapp/verify
 * Body: { action: "send" | "confirm", phone: string, code?: string }
 *
 * "send"    → generates OTP, sends via WhatsApp, stores in memory
 * "confirm" → verifies OTP, links phone to user profile
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action, phone, code } = body;

    if (!phone || typeof phone !== 'string') {
      return NextResponse.json({ error: 'Phone number required' }, { status: 400 });
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
      return await handleConfirmOTP(user.id, cleanPhone, code.trim());
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
  const lastSent = sendRateLimit.get(phone);
  if (lastSent && Date.now() - lastSent < RATE_LIMIT_MS) {
    const waitSecs = Math.ceil((RATE_LIMIT_MS - (Date.now() - lastSent)) / 1000);
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
  otpStore.set(phone, {
    code: otp,
    userId,
    expiresAt: Date.now() + OTP_EXPIRY_MS,
    attempts: 0,
  });
  sendRateLimit.set(phone, Date.now());

  // Send OTP via WhatsApp
  await sendTextMessage(
    waNumber,
    `🔐 Your EffortOS verification code is: *${otp}*\n\nThis code expires in 5 minutes. If you didn't request this, ignore this message.`,
  );

  return NextResponse.json({ sent: true, expiresIn: OTP_EXPIRY_MS / 1000 });
}

async function handleConfirmOTP(userId: string, phone: string, code: string) {
  const entry = otpStore.get(phone);

  if (!entry) {
    return NextResponse.json(
      { error: 'No verification code found. Please request a new one.' },
      { status: 400 },
    );
  }

  // Check expiry
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(phone);
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
    otpStore.delete(phone);
    return NextResponse.json(
      { error: 'Too many attempts. Please request a new code.' },
      { status: 429 },
    );
  }

  // Verify code
  if (entry.code !== code) {
    entry.attempts++;
    const remaining = MAX_ATTEMPTS - entry.attempts;
    return NextResponse.json(
      { error: `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` },
      { status: 400 },
    );
  }

  // OTP verified — link phone to profile
  // NOTE: Delete OTP AFTER successful DB write (not before) to avoid race condition
  const serviceClient = createServiceClient();
  const { error: dbError } = await serviceClient
    .from('profiles')
    .update({ phone_number: phone, whatsapp_linked: true })
    .eq('id', userId);

  if (dbError) {
    console.error('Failed to link phone:', dbError);
    return NextResponse.json({ error: 'Failed to save. Try again.' }, { status: 500 });
  }

  // DB update succeeded — now safe to clear OTP
  otpStore.delete(phone);

  // Send confirmation via WhatsApp
  const waNumber = phone.replace('+', '');
  await sendTextMessage(
    waNumber,
    `✅ WhatsApp linked to EffortOS!\n\nYou can now manage tasks from here. Try:\n• "Study React for 2 pomodoros"\n• "What's my plan?"\n• "Done with React"\n• "How am I doing?"`,
  );

  return NextResponse.json({ verified: true });
}
