import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireActiveSub } from '@/lib/subscription-guard';
import { rateLimitOrNull } from '@/lib/ratelimit';

// Node runtime — requireActiveSub uses Supabase SSR cookies which need Node APIs.
export const runtime = 'nodejs';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

// Trim every user-supplied string before it lands in the prompt; this is our
// belt-and-braces against prompt-injection-via-profile and runaway tokens.
const cap = (s: unknown, max: number) =>
  typeof s === 'string' ? s.slice(0, max) : '';

export async function POST(req: Request) {
  // 1. Auth + active subscription (or trial) gate.
  const gate = await requireActiveSub();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.reason }, { status: gate.status });
  }

  // 2. Per-user rate limit (light bucket — this fires once per dashboard load).
  const blocked = await rateLimitOrNull(gate.userId, 'light');
  if (blocked) return blocked;

  // 3. Anthropic key required — fail loud rather than serving silent empties.
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'AI Coach not configured' },
      { status: 503 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const userName = cap(body.userName, 80);
    const streak = Number.isFinite(body.streak) ? Number(body.streak) : 0;
    const goalTitle = cap(body.goalTitle, 120);
    const completionPct = Number.isFinite(body.completionPct)
      ? Math.max(0, Math.min(100, Number(body.completionPct)))
      : 0;
    const incompleteTasks = Number.isFinite(body.incompleteTasks)
      ? Math.max(0, Math.min(999, Number(body.incompleteTasks)))
      : 0;
    const paceStatus = cap(body.paceStatus, 40);

    const prompt = `Generate a single short motivational one-liner (max 15 words) for a productivity app user.

Context:
- Name: ${userName}
- Current streak: ${streak} days
- Working on: "${goalTitle}"
- Progress: ${completionPct}%
- Pending tasks today: ${incompleteTasks}
- Pace: ${paceStatus || 'unknown'}

Rules:
- Be warm, specific, not generic
- Reference their streak or goal naturally if relevant
- Never guilt-trip
- No emojis
- Just the one line, nothing else`;

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';

    return NextResponse.json({ message: text });
  } catch (err) {
    console.error('[Daily Brief AI]', err);
    // Soft-fail to the UI: dashboard renders without the brief rather than
    // showing an error toast for a non-critical motivational line.
    return NextResponse.json({ message: '' }, { status: 200 });
  }
}
