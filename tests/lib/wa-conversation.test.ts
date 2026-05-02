/**
 * Unit coverage for the conversation-memory formatter.
 *
 * The DB-backed read/write helpers are intentionally NOT covered here —
 * they delegate to a Supabase service-role client and we don't drive a
 * real Postgres in tests. Their failure modes (table missing, generic
 * DB error) are wrapped in try/catch and degrade to empty/no-op, so a
 * smoke test would just be exercising the mock library.
 *
 * What we DO test is the prompt-rendering format, because a regression
 * there would break the parser's ability to resolve referential
 * ambiguity ("the second one") and we'd never notice without a unit
 * test — the bot would just feel a bit dumber than it should.
 */

import { describe, it, expect } from 'vitest';
import {
  formatConversationForPrompt,
  type ConversationMessage,
} from '@/lib/wa-conversation';

const ts = (offsetMin: number) =>
  new Date(Date.now() - offsetMin * 60_000).toISOString();

describe('formatConversationForPrompt', () => {
  it('returns empty string when no messages', () => {
    expect(formatConversationForPrompt([])).toBe('');
  });

  it('renders a single user turn with the right tag', () => {
    const out = formatConversationForPrompt([
      { role: 'user', content: 'finish react', created_at: ts(2) },
    ]);
    expect(out).toContain('<RECENT_CONVERSATION>');
    expect(out).toContain('</RECENT_CONVERSATION>');
    expect(out).toContain('USER: finish react');
  });

  it('renders user + bot turns with distinct prefixes', () => {
    const msgs: ConversationMessage[] = [
      { role: 'user', content: 'tasks', created_at: ts(5) },
      { role: 'bot', content: '1. React 2. Math', created_at: ts(4) },
      { role: 'user', content: 'done 1', created_at: ts(0) },
    ];
    const out = formatConversationForPrompt(msgs);
    expect(out).toContain('USER: tasks');
    expect(out).toContain('BOT: 1. React 2. Math');
    expect(out).toContain('USER: done 1');
    // Order matters — chronological top-to-bottom so the model can
    // resolve "done 1" against the bot's preceding numbered list.
    const userIdx = out.indexOf('USER: tasks');
    const botIdx = out.indexOf('BOT: 1. React 2. Math');
    const finalIdx = out.indexOf('USER: done 1');
    expect(userIdx).toBeLessThan(botIdx);
    expect(botIdx).toBeLessThan(finalIdx);
  });

  it('compresses whitespace and clips long content', () => {
    const longContent = 'a'.repeat(1000);
    const out = formatConversationForPrompt([
      {
        role: 'user',
        content: `line1\n\n\n   line2   ${longContent}`,
        created_at: ts(1),
      },
    ]);
    // Multi-newline runs collapse to a single space.
    expect(out).not.toMatch(/\n\s*\n/);
    // Per-line cap is 400 chars + the role prefix; the 1000-char run
    // must be truncated.
    const userLine = out.split('\n').find((l) => l.startsWith('USER:')) ?? '';
    expect(userLine.length).toBeLessThanOrEqual('USER: '.length + 400);
  });

  it('uses RECENT_CONVERSATION tags so the model treats it as data', () => {
    const out = formatConversationForPrompt([
      { role: 'user', content: 'hi', created_at: ts(1) },
    ]);
    // The opening tag mirrors <USER_MESSAGE> conventions used elsewhere
    // in the system prompt — keeps the prompt-injection defence shape
    // consistent across blocks.
    expect(out).toMatch(/^<RECENT_CONVERSATION>/);
    expect(out).toMatch(/<\/RECENT_CONVERSATION>$/);
  });
});
