import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireActiveSub } from '@/lib/subscription-guard';
import { rateLimitOrNull } from '@/lib/ratelimit';

/* ─────────────────────────────────────────────────────────────────────
 * /api/coach/journal-prompt
 * --------------------------------------------------------------------
 * Generates ONE short reflective writing prompt for the user to use as
 * a marker when writing today's journal entry. Not a chat — the user
 * burns this request once per day (enforced client-side by the
 * presence of `ai_prompt` on the JournalEntry row) and writes their
 * own entry against it.
 *
 * The prompt should read more like a thoughtful friend's gentle
 * nudge than a therapy worksheet — the goal is to unstick a blank
 * page, not to push anyone toward introspection they don't want.
 * ──────────────────────────────────────────────────────────────────── */

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export async function POST(request: Request) {
  try {
    const gate = await requireActiveSub();
    if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: gate.status });

    // Per-user rate limit. Journal prompts are one-per-entry client-side,
    // but we still guard the route in case someone calls it directly.
    const blocked = await rateLimitOrNull(gate.userId, 'light');
    if (blocked) return blocked;

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'AI Coach not configured' }, { status: 503 });
    }

    // All inputs optional — the prompt works fine with zero context, it
    // just gets more specific when we pass it any.
    const {
      date,
      mood,
      goalTitle,
      sessionsCompleted,
      sessionsTotal,
      streakDays,
      userName,
    } = await request.json();

    // Compute a short, human-friendly weekday descriptor so prompts can
    // reference "a Sunday evening" etc. without us having to prompt-engineer
    // Claude to do date parsing.
    let weekday = '';
    if (typeof date === 'string') {
      try {
        weekday = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
      } catch { /* best-effort */ }
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 180,
      system: `You generate ONE reflective journaling prompt (1-2 sentences, max 30 words) for a productivity app user who is about to write their daily journal entry.

Rules:
- Write in second person ("you", "your").
- Be an opening question or nudge, not a lecture.
- Reference the user's context (mood, goal, streak) only if it genuinely sharpens the prompt — do not force it.
- Vary style across requests: sometimes curious, sometimes grounding, sometimes forward-looking, sometimes playful.
- Avoid therapy-speak ("how does that make you feel"). Keep it warm and concrete.
- Never mention "journaling" or "the prompt" — just ask the question.
- No exclamation marks. No emojis. No quotes around the output.
- Return ONLY the prompt text.`,
      messages: [{
        role: 'user',
        content: `User: ${userName || 'the user'}
Weekday: ${weekday || 'today'}
Mood so far: ${mood || 'not set'}
Current goal: ${goalTitle || 'no active goal'}
Progress: ${typeof sessionsCompleted === 'number' && typeof sessionsTotal === 'number' ? `${sessionsCompleted}/${sessionsTotal} sessions` : 'n/a'}
Streak: ${typeof streakDays === 'number' ? `${streakDays} days` : 'n/a'}`,
      }],
    });

    const prompt = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()
      .replace(/^["']|["']$/g, ''); // Strip surrounding quotes if any

    return NextResponse.json({ prompt });
  } catch (err) {
    console.error('Journal prompt generation error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
