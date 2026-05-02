/**
 * Unit coverage for the phase-3 additions to whatsapp-ai:
 *
 *   - hardenIntent: multi_intent collapsing, clarify validation,
 *     add_goal field clamping, the existing destructive-query
 *     defences (still working).
 *   - isPrimitiveIntent: type-guard correctness.
 *
 * The full parseWhatsAppMessage path (Anthropic call, prompt rendering,
 * JSON extraction) is integration-heavy; these tests instead pin down
 * the *post-AI* hardening logic, which is the actual security boundary.
 */

import { describe, it, expect } from 'vitest';
import { hardenIntent, isPrimitiveIntent } from '@/lib/whatsapp-ai';

describe('hardenIntent — multi_intent', () => {
  it('returns the single sub-intent unwrapped when only one valid sub remains', () => {
    const out = hardenIntent({
      type: 'multi_intent',
      intents: [
        { type: 'list_tasks' },
      ],
    }, 'show my tasks then nothing');
    // Trivial wrappers collapse so downstream handlers don't have to
    // special-case length-1 multi_intent.
    expect(out.type).toBe('list_tasks');
  });

  it('drops nested multi_intent / chat / unknown sub-intents', () => {
    const out = hardenIntent({
      type: 'multi_intent',
      intents: [
        { type: 'list_tasks' },
        { type: 'multi_intent', intents: [] },        // nested — strip
        { type: 'chat_about_tasks', raw: 'hi' },      // non-primitive — strip
        { type: 'unknown', raw: 'x' },                // non-primitive — strip
        { type: 'plan_tomorrow' },
      ],
    }, 'list tasks then plan tomorrow');
    expect(out.type).toBe('multi_intent');
    if (out.type !== 'multi_intent') return; // narrow
    expect(out.intents).toHaveLength(2);
    expect(out.intents[0].type).toBe('list_tasks');
    expect(out.intents[1].type).toBe('plan_tomorrow');
  });

  it('caps multi_intent at 4 sub-intents', () => {
    const out = hardenIntent({
      type: 'multi_intent',
      intents: Array.from({ length: 8 }, () => ({ type: 'list_tasks' })),
    }, 'list tasks 8 times');
    if (out.type !== 'multi_intent') {
      // At length 1 we collapse, so 8 list_tasks should still produce
      // a multi_intent (length 4) since they all survive harden.
      throw new Error(`expected multi_intent, got ${out.type}`);
    }
    expect(out.intents).toHaveLength(4);
  });

  it('returns unknown when all sub-intents are invalid', () => {
    const out = hardenIntent({
      type: 'multi_intent',
      intents: [
        { type: 'multi_intent', intents: [] },
        { type: 'chat_about_tasks', raw: 'hi' },
        { type: 'off_topic' }, // non-primitive
      ],
    }, 'all garbage');
    expect(out.type).toBe('unknown');
  });
});

describe('hardenIntent — clarify', () => {
  it('accepts a valid clarify with 2 options', () => {
    const out = hardenIntent({
      type: 'clarify',
      question: 'Which one?',
      options: [
        { label: 'Math homework', value: 'math homework' },
        { label: 'Math review', value: 'math review' },
      ],
    }, 'complete math');
    expect(out.type).toBe('clarify');
    if (out.type !== 'clarify') return;
    expect(out.options).toHaveLength(2);
    expect(out.options[0].label).toBe('Math homework');
  });

  it('degrades to unknown when fewer than 2 valid options', () => {
    const out = hardenIntent({
      type: 'clarify',
      question: 'Which one?',
      options: [
        { label: 'Math homework', value: 'math homework' },
      ],
    }, 'complete math');
    // A clarify with 1 option would be a one-button prompt — useless;
    // we'd rather show the generic "didn't catch that" fallback.
    expect(out.type).toBe('unknown');
  });

  it('strips control characters from question and labels', () => {
    const out = hardenIntent({
      type: 'clarify',
      question: 'Which one?',
      options: [
        { label: 'Math homework', value: 'math homework' },
        { label: 'Math review', value: 'math review' },
      ],
    }, 'complete math');
    expect(out.type).toBe('clarify');
    if (out.type !== 'clarify') return;
    expect(out.question).not.toContain('');
    expect(out.options[0].label).not.toContain('');
  });

  it('caps options at 4', () => {
    const out = hardenIntent({
      type: 'clarify',
      question: 'Which one?',
      options: Array.from({ length: 7 }, (_, i) => ({
        label: `Option ${i}`,
        value: `option-${i}`,
      })),
    }, 'complete option');
    if (out.type !== 'clarify') throw new Error('expected clarify');
    expect(out.options).toHaveLength(4);
  });
});

describe('hardenIntent — add_goal', () => {
  it('accepts a valid title-only add_goal', () => {
    const out = hardenIntent({
      type: 'add_goal',
      title: 'Learn classical guitar',
    }, 'set a goal: learn classical guitar');
    expect(out.type).toBe('add_goal');
    if (out.type !== 'add_goal') return;
    expect(out.title).toBe('Learn classical guitar');
    expect(out.estimatedSessions).toBeUndefined();
    expect(out.deadline).toBeUndefined();
  });

  it('clamps an out-of-range estimatedSessions', () => {
    const tooBig = hardenIntent({
      type: 'add_goal',
      title: 'X',
      estimatedSessions: 99999,
    }, 'x');
    if (tooBig.type !== 'add_goal') throw new Error('expected add_goal');
    // Above the 5000 cap → field is dropped; goal still created.
    expect(tooBig.estimatedSessions).toBeUndefined();

    const negative = hardenIntent({
      type: 'add_goal',
      title: 'X',
      estimatedSessions: -3,
    }, 'x');
    if (negative.type !== 'add_goal') throw new Error('expected add_goal');
    expect(negative.estimatedSessions).toBeUndefined();
  });

  it('rejects free-form deadline strings, accepts ISO YYYY-MM-DD', () => {
    const future = new Date();
    future.setUTCMonth(future.getUTCMonth() + 6);
    const futureIso = future.toISOString().slice(0, 10);

    const ok = hardenIntent({
      type: 'add_goal',
      title: 'X',
      deadline: futureIso,
    }, 'x');
    if (ok.type !== 'add_goal') throw new Error('expected add_goal');
    expect(ok.deadline).toBe(futureIso);

    const bad = hardenIntent({
      type: 'add_goal',
      title: 'X',
      deadline: 'next christmas',
    }, 'x');
    if (bad.type !== 'add_goal') throw new Error('expected add_goal');
    expect(bad.deadline).toBeUndefined();
  });

  it('rejects past deadlines and deadlines beyond 10-year horizon', () => {
    const past = hardenIntent({
      type: 'add_goal',
      title: 'X',
      deadline: '2020-01-01',
    }, 'x');
    if (past.type !== 'add_goal') throw new Error('expected add_goal');
    expect(past.deadline).toBeUndefined();

    const tooFar = hardenIntent({
      type: 'add_goal',
      title: 'X',
      deadline: '2099-12-31',
    }, 'x');
    if (tooFar.type !== 'add_goal') throw new Error('expected add_goal');
    expect(tooFar.deadline).toBeUndefined();
  });

  it('returns unknown when title is empty after sanitisation', () => {
    const out = hardenIntent({
      type: 'add_goal',
      title: '',
    }, 'set a goal');
    expect(out.type).toBe('unknown');
  });
});

describe('hardenIntent — existing destructive-query defences still hold', () => {
  it('rejects delete_task with query "all"', () => {
    const out = hardenIntent({
      type: 'delete_task',
      query: 'all',
    }, 'delete all');
    expect(out.type).toBe('unknown');
  });

  it('rejects complete_task with too-short query', () => {
    const out = hardenIntent({
      type: 'complete_task',
      query: 'ab',
    }, 'done ab');
    expect(out.type).toBe('unknown');
  });
});

describe('isPrimitiveIntent', () => {
  it('returns true for primitive intent kinds', () => {
    expect(isPrimitiveIntent({ type: 'list_tasks' })).toBe(true);
    expect(isPrimitiveIntent({ type: 'add_tasks', tasks: [] })).toBe(true);
    expect(isPrimitiveIntent({ type: 'add_goal', title: 'X' })).toBe(true);
  });

  it('returns false for meta and fallback kinds', () => {
    expect(isPrimitiveIntent({ type: 'multi_intent', intents: [] })).toBe(false);
    expect(isPrimitiveIntent({ type: 'clarify', question: 'q', options: [] })).toBe(false);
    expect(isPrimitiveIntent({ type: 'chat_about_tasks', raw: '' })).toBe(false);
    expect(isPrimitiveIntent({ type: 'off_topic' })).toBe(false);
    expect(isPrimitiveIntent({ type: 'unknown', raw: '' })).toBe(false);
  });
});
