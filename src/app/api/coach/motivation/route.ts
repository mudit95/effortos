import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireActiveSub } from '@/lib/subscription-guard';
import { rateLimitOrNull } from '@/lib/ratelimit';
import { ensureAiQuota, recordAiUsage, getUserAiTier } from '@/lib/aiQuota';
import { createClient } from '@/lib/supabase/server';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export async function POST(request: Request) {
  try {
    const gate = await requireActiveSub();
    if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });

    // Per-user rate limit: 20 motivation messages/hour.
    const blocked = await rateLimitOrNull(gate.userId, 'light');
    if (blocked) return blocked;

    // Per-user daily token cap. See lib/aiQuota.ts.
    const supabase = await createClient();
    const aiTier = await getUserAiTier(supabase, gate.userId);
    const quota = await ensureAiQuota(gate.userId, aiTier);
    if (!quota.ok) {
      return NextResponse.json(
        { error: 'Daily AI quota reached', resetAt: quota.resetAt, used: quota.used, limit: quota.limit },
        { status: 429 },
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'AI Coach not configured' }, { status: 503 });
    }

    const { taskTitle, goalTitle, sessionsCompleted, sessionsTotal, streakDays, userName } = await request.json();

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 128,
      system: `You generate ONE short motivational message (max 15 words) for a focus timer app.
Rules:
- Reference the specific task or goal when provided
- Be warm, specific, and action-oriented
- No quotes from famous people. Be original.
- No exclamation marks. Keep it calm and confident.
- Vary your style: sometimes encouraging, sometimes reflective, sometimes practical
- Return ONLY the message text, nothing else.`,
      messages: [{
        role: 'user',
        content: `User: ${userName || 'there'}
Task: ${taskTitle || 'focused work'}
Goal: ${goalTitle || 'their goal'}
Progress: ${sessionsCompleted}/${sessionsTotal} sessions done
Streak: ${streakDays} days`,
      }],
    });

    await recordAiUsage(gate.userId, message.usage);

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()
      .replace(/^["']|["']$/g, ''); // Strip surrounding quotes if any

    return NextResponse.json({ message: text });
  } catch (err) {
    console.error('Motivation message error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
