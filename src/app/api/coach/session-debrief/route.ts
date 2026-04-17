import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildSessionDebriefPrompt, type SessionDebriefRequest } from '@/lib/coach';
import { requireActiveSub } from '@/lib/subscription-guard';
import { rateLimitOrNull } from '@/lib/ratelimit';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export async function POST(request: Request) {
  try {
    const gate = await requireActiveSub();
    if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });

    // One debrief per session is the expected cadence; 5/day absorbs retries and edits.
    const blocked = await rateLimitOrNull(gate.userId, 'heavy');
    if (blocked) return blocked;

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'AI Coach not configured' }, { status: 503 });
    }

    const body: SessionDebriefRequest = await request.json();
    const { system, user } = buildSessionDebriefPrompt(body);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    const debrief = JSON.parse(jsonMatch[0]);
    return NextResponse.json(debrief);
  } catch (err) {
    console.error('Session Debrief error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
