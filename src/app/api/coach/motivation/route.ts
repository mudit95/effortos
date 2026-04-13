import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireActiveSub } from '@/lib/subscription-guard';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export async function POST(request: Request) {
  try {
    const gate = await requireActiveSub();
    if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'AI Coach not configured' }, { status: 503 });
    }

    const { taskTitle, goalTitle, sessionsCompleted, sessionsTotal, streakDays, userName } = await request.json();

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
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
