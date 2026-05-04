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

    // Per-user rate limit: 20 insights/hour. Cheap call, called often on the dashboard.
    const blocked = await rateLimitOrNull(gate.userId, 'light');
    if (blocked) return blocked;

    // Per-user daily AI token cap. Independent from the rate-limit above
    // (which is requests/hour, not tokens/day) and meant to catch
    // sustained abuse over 24h. See lib/aiQuota.ts for the pattern.
    const supabase = await createClient();
    const aiTier = await getUserAiTier(supabase, gate.userId);
    const quota = await ensureAiQuota(gate.userId, aiTier);
    if (!quota.ok) {
      return NextResponse.json(
        {
          error: 'Daily AI quota reached',
          resetAt: quota.resetAt,
          used: quota.used,
          limit: quota.limit,
        },
        { status: 429 },
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'AI Coach not configured' }, { status: 503 });
    }

    const {
      goalTitle,
      sessionsCompleted,
      sessionsTotal,
      streakDays,
      context,
      totalHoursInvested,
    } = await request.json();

    const message = await anthropic.messages.create({
      // Haiku is the right cost tier for a 2-3 sentence output. Was
      // previously Sonnet (~12× more expensive); the prompt doesn't
      // need Sonnet's reasoning depth.
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: `You generate ONE concise, data-driven insight (2-3 sentences max) for a productivity app user.
Rules:
- Focus on patterns, peak times, or actionable suggestions
- Reference the user's specific data (sessions, streak, progress)
- No generic platitudes. Be specific and practical.
- Vary insights: sometimes about pace, sometimes about consistency, sometimes about milestones
- Return ONLY the insight text, nothing else.`,
      messages: [
        {
          role: 'user',
          content: `Goal: ${goalTitle || 'their goal'}
Sessions completed: ${sessionsCompleted}/${sessionsTotal}
Current streak: ${streakDays} days
Context: ${context === 'daily' ? 'Help them focus on today\'s session.' : 'Help them understand long-term progress.'}
${totalHoursInvested ? `Total hours invested: ${totalHoursInvested}` : ''}`,
        },
      ],
    });

    // Record actual token usage against the user's daily bucket. Fire-and-
    // forget: if the Redis write fails the call has already succeeded.
    await recordAiUsage(gate.userId, message.usage);

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .replace(/^["']|["']$/g, ''); // Strip surrounding quotes if any

    return NextResponse.json({ insight: text });
  } catch (err) {
    console.error('Insight generation error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
