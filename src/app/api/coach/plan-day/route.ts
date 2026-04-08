import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildPlanMyDayPrompt, type PlanMyDayRequest } from '@/lib/coach';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export async function POST(request: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'AI Coach not configured' }, { status: 503 });
    }

    const body: PlanMyDayRequest = await request.json();
    const { system, user } = buildPlanMyDayPrompt(body);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: user }],
    });

    // Extract text content
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Parse the JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    const plan = JSON.parse(jsonMatch[0]);
    return NextResponse.json(plan);
  } catch (err) {
    console.error('Plan My Day error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
