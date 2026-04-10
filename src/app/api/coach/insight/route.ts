import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export async function POST(request: Request) {
  try {
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
      model: 'claude-sonnet-4-20250514',
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
