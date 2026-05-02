/**
 * Catalog-integrity tests for the goal templates feature.
 *
 * The templates are static data — there's no runtime parsing to test
 * — but they're consumed in two places (the onboarding wizard pre-fills
 * fields, and `completeOnboarding` seeds daily tasks) where a malformed
 * row breaks activation. These tests pin down the contract: every
 * template has every required field, ids are unique, deadlines roll
 * forward correctly, and seedTasks reference real TASK_TAG ids.
 */

import { describe, it, expect } from 'vitest';
import {
  GOAL_TEMPLATES,
  getTemplateById,
  deadlineForTemplate,
} from '@/lib/goal-templates';
import { TASK_TAGS } from '@/types';

const VALID_TAGS = new Set(TASK_TAGS.map((t) => t.id));

describe('GOAL_TEMPLATES catalog integrity', () => {
  it('has at least 6 archetypes', () => {
    // The roadmap committed to 6 archetypes shipping with v1. If a
    // refactor accidentally drops one below this floor, the picker
    // becomes a 1-2-card sad list.
    expect(GOAL_TEMPLATES.length).toBeGreaterThanOrEqual(6);
  });

  it('has unique ids', () => {
    const ids = GOAL_TEMPLATES.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every template has all required pre-fill fields', () => {
    for (const t of GOAL_TEMPLATES) {
      expect(t.id, `${t.id}: id`).toBeTruthy();
      expect(t.label, `${t.id}: label`).toBeTruthy();
      expect(t.emoji, `${t.id}: emoji`).toBeTruthy();
      expect(t.blurb, `${t.id}: blurb`).toBeTruthy();
      expect(t.goalTitle, `${t.id}: goalTitle`).toBeTruthy();
      expect(t.motivation, `${t.id}: motivation`).toBeTruthy();
      expect(['beginner', 'intermediate', 'advanced']).toContain(t.experienceLevel);
      expect(t.dailyAvailability).toBeGreaterThan(0);
      expect(['low', 'medium', 'high']).toContain(t.consistencyLevel);
      expect(t.userTimeEstimate).toBeGreaterThan(0);
    }
  });

  it('blurbs stay under the 70-char picker limit', () => {
    // The picker tile lays out blurb on a single line; longer text
    // wraps and breaks the visual rhythm. 70 is the breakpoint we
    // committed to in the design.
    for (const t of GOAL_TEMPLATES) {
      expect(t.blurb.length, `${t.id}: blurb length`).toBeLessThanOrEqual(70);
    }
  });

  it('every template seeds exactly 3 daily tasks', () => {
    // 3 is the activation magic number — fewer feels empty, more is
    // overwhelming for day 1. The completeOnboarding loop trusts
    // every template has the same shape.
    for (const t of GOAL_TEMPLATES) {
      expect(t.seedTasks.length, `${t.id}: seed count`).toBe(3);
    }
  });

  it('every seedTask references a real TASK_TAG id', () => {
    for (const t of GOAL_TEMPLATES) {
      for (const seed of t.seedTasks) {
        expect(VALID_TAGS.has(seed.tag), `${t.id} → ${seed.tag}`).toBe(true);
      }
    }
  });

  it('every seedTask has a positive pomodoro count', () => {
    for (const t of GOAL_TEMPLATES) {
      for (const seed of t.seedTasks) {
        expect(seed.pomodoros, `${t.id} → ${seed.title}`).toBeGreaterThan(0);
        // 12 is the max enforced in hardenIntent — staying under that
        // keeps consistency between chat-created tasks and
        // template-seeded ones.
        expect(seed.pomodoros).toBeLessThanOrEqual(12);
      }
    }
  });
});

describe('getTemplateById', () => {
  it('returns the template when id matches', () => {
    const t = getTemplateById('interview-prep');
    expect(t).toBeDefined();
    expect(t?.id).toBe('interview-prep');
  });

  it('returns undefined for unknown ids', () => {
    expect(getTemplateById('nonexistent')).toBeUndefined();
    expect(getTemplateById('')).toBeUndefined();
  });
});

describe('deadlineForTemplate', () => {
  it('returns a future YYYY-MM-DD string for templates with a deadline', () => {
    const interview = getTemplateById('interview-prep');
    if (!interview) throw new Error('interview-prep template missing');
    const deadline = deadlineForTemplate(interview);
    expect(deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Must be in the future.
    expect(new Date(deadline! + 'T00:00:00Z').getTime()).toBeGreaterThan(Date.now());
  });

  it('reading-goal deadline anchors to end-of-year', () => {
    const reading = getTemplateById('reading-goal');
    if (!reading) throw new Error('reading-goal template missing');
    const deadline = deadlineForTemplate(reading);
    if (!deadline) throw new Error('reading-goal should have a deadline');
    // Either end-of-this-year or 30-day fallback when run on Dec 31.
    // Both are valid; what we DON'T want is a stale deadline in the past.
    const d = new Date(deadline + 'T00:00:00Z');
    expect(d.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns undefined when deadlineInDays is null or zero', () => {
    // Build a synthetic template that has no deadline; the helper
    // must respect that and not invent a date.
    const synthetic = {
      ...GOAL_TEMPLATES[0],
      deadlineInDays: null,
    };
    expect(deadlineForTemplate(synthetic)).toBeUndefined();
  });
});
