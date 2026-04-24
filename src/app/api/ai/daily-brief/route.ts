import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'edge';

const client = new Anthropic();

export async function POST(req: Request) {
  try {
    const { userName, streak, goalTitle, completionPct, incompleteTasks, paceStatus } = await req.json();

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
      model: 'claude-haiku-4-5-20241022',
      max_tokens: 60,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';

    return NextResponse.json({ message: text });
  } catch (err) {
    console.error('[Daily Brief AI]', err);
    // Fallback — don't break the UI
    return NextResponse.json({ message: '' });
  }
}
