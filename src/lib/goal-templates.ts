/**
 * Goal templates / quick-start archetypes.
 *
 * Onboarding's free-text "what do you want to accomplish?" step has
 * blank-page friction — many would-be users drop here. Templates let
 * a user pick an archetype that matches their use case, pre-fills the
 * goal title + estimation inputs, and seeds the first three daily
 * tasks for today so they can be running a focus session within 30
 * seconds of landing on onboarding step 0.
 *
 * Picking a template skips the motivation/context/perception steps
 * (1-3) and jumps to the persona step (4); see OnboardingFlow.tsx.
 *
 * Each template's seed_tasks are inserted as daily_tasks rows for
 * today (user's local date) at goal-creation time. They're plain
 * starter tasks — the user is expected to edit them or replace them
 * within a day or two. The goal isn't to lock in tasks; it's to
 * remove the "what do I do first?" friction.
 *
 * Adding a template:
 *   1. Append a new GoalTemplate to GOAL_TEMPLATES below.
 *   2. Pick a stable id (kebab-case, never reused).
 *   3. Provide every required field — types/onboarding flow assume them.
 *   4. Pick seed_tasks that map to a real TASK_TAG so the daily-grind
 *      colours look correct out of the gate.
 */

import type { TaskTagId } from '@/types';

/**
 * One archetype shown as a card on onboarding step 0. All fields except
 * `seed_tasks` map 1:1 onto OnboardingData; seed_tasks are inserted as
 * daily_tasks rows after the goal is created.
 */
export interface GoalTemplate {
  /** Stable identifier — referenced by analytics events and OnboardingData.templateId. */
  id: string;
  /** Display label in the picker tile. Short and recognisable. */
  label: string;
  /** Single emoji shown in the tile header. */
  emoji: string;
  /** One-line "this template is for…" description (≤ 70 chars). */
  blurb: string;

  // ── Pre-filled OnboardingData fields ──
  /**
   * Pre-filled goal title. The wizard renders this as editable so the
   * user can rephrase ("Land my next role" → "Land senior PM role at Stripe").
   */
  goalTitle: string;
  motivation: 'career' | 'personal' | 'learning' | 'health' | 'creative' | 'accountability';
  experienceLevel: 'beginner' | 'intermediate' | 'advanced';
  /** Hours per day the user expects to spend. */
  dailyAvailability: number;
  consistencyLevel: 'low' | 'medium' | 'high';
  /**
   * The user's own time estimate, in hours. Used by `calculateTimeBias`
   * during goal creation to weight subsequent recalibrations. Templates
   * pick a sensible default; users can correct in the perception step
   * if they backtrack.
   */
  userTimeEstimate: number;
  /**
   * Days until target completion, relative to creation date. The
   * wizard converts this to an absolute YYYY-MM-DD when populating
   * onboardingData.deadline. Null = no deadline.
   */
  deadlineInDays: number | null;

  // ── Seed daily tasks ──
  /**
   * 3 starter daily-task templates. Inserted into daily_tasks for the
   * user's local "today" right after the goal row is created. Tag is
   * applied straight; pomodoros sets the target.
   */
  seedTasks: ReadonlyArray<{
    title: string;
    pomodoros: number;
    tag: TaskTagId;
  }>;
}

/**
 * The catalog. Keep this list short — too many archetypes overwhelm
 * the picker. Six covers the bulk of real use cases; if user research
 * surfaces another archetype with > 5% template selection, add it.
 *
 * Order matters — the picker renders top-to-bottom in this order. We
 * front-load the most commonly-picked archetypes (interview, side
 * project, learn-a-skill).
 */
export const GOAL_TEMPLATES: ReadonlyArray<GoalTemplate> = [
  {
    id: 'interview-prep',
    label: 'Land my next role',
    emoji: '🎯',
    blurb: 'Job interview / promotion prep — behavioral + technical.',
    goalTitle: 'Land my next role',
    motivation: 'career',
    experienceLevel: 'intermediate',
    dailyAvailability: 1.5,
    consistencyLevel: 'medium',
    userTimeEstimate: 12,
    deadlineInDays: 30,
    seedTasks: [
      { title: 'Practise one behavioral question (STAR format)', pomodoros: 1, tag: 'job' },
      { title: 'Solve 2 algorithmic problems', pomodoros: 2, tag: 'job' },
      { title: 'Update one bullet on resume', pomodoros: 1, tag: 'job' },
    ],
  },

  {
    id: 'ship-mvp',
    label: 'Ship a side project',
    emoji: '🚀',
    blurb: 'MVP / indie launch — building something end-to-end.',
    goalTitle: 'Ship MVP',
    motivation: 'personal',
    experienceLevel: 'intermediate',
    dailyAvailability: 2,
    consistencyLevel: 'medium',
    userTimeEstimate: 30,
    deadlineInDays: 60,
    seedTasks: [
      { title: 'Define core MVP feature scope', pomodoros: 1, tag: 'startup' },
      { title: 'Set up project skeleton + auth', pomodoros: 2, tag: 'startup' },
      { title: 'Sketch landing-page wireframe', pomodoros: 1, tag: 'creative' },
    ],
  },

  {
    id: 'learn-skill',
    label: 'Learn a new skill',
    emoji: '📚',
    blurb: 'Pick up something new — language, framework, instrument, etc.',
    goalTitle: 'Learn a new skill',
    motivation: 'learning',
    experienceLevel: 'beginner',
    dailyAvailability: 1,
    consistencyLevel: 'medium',
    userTimeEstimate: 20,
    deadlineInDays: 60,
    seedTasks: [
      { title: 'Outline the topics I need to cover', pomodoros: 1, tag: 'learning' },
      { title: 'Read intro chapter / first lesson', pomodoros: 1, tag: 'learning' },
      { title: 'Take notes on key concepts', pomodoros: 1, tag: 'learning' },
    ],
  },

  {
    id: 'fitness-routine',
    label: 'Build a fitness habit',
    emoji: '💪',
    blurb: 'Daily movement, training plan, or weight goal.',
    goalTitle: 'Build daily exercise habit',
    motivation: 'health',
    experienceLevel: 'beginner',
    dailyAvailability: 0.5,
    consistencyLevel: 'high',
    userTimeEstimate: 12,
    deadlineInDays: 45,
    seedTasks: [
      { title: '20-minute walk or stretch', pomodoros: 1, tag: 'health' },
      { title: 'Plan tomorrow’s workout', pomodoros: 1, tag: 'health' },
      { title: 'Track water + meals for the day', pomodoros: 1, tag: 'health' },
    ],
  },

  {
    id: 'thesis-writing',
    label: 'Finish a thesis or paper',
    emoji: '📝',
    blurb: 'Long-form writing — dissertation, research paper, book.',
    goalTitle: 'Finish thesis chapter',
    motivation: 'learning',
    experienceLevel: 'advanced',
    dailyAvailability: 2,
    consistencyLevel: 'medium',
    userTimeEstimate: 40,
    deadlineInDays: 90,
    seedTasks: [
      { title: 'Draft outline of next section', pomodoros: 1, tag: 'creative' },
      { title: 'Read 2 source papers, take notes', pomodoros: 2, tag: 'learning' },
      { title: 'Write 500 words', pomodoros: 2, tag: 'creative' },
    ],
  },

  {
    id: 'reading-goal',
    label: 'Read more books',
    emoji: '📖',
    blurb: 'Annual reading challenge or specific reading list.',
    goalTitle: 'Read 12 books this year',
    motivation: 'personal',
    experienceLevel: 'beginner',
    dailyAvailability: 0.5,
    consistencyLevel: 'medium',
    userTimeEstimate: 20,
    // Default: end-of-year deadline. We stash the relative-days field
    // anyway so the wizard can render "Target: Dec 31" cleanly even
    // when started mid-year.
    deadlineInDays: daysUntilEndOfYear(),
    seedTasks: [
      { title: 'Read for 25 minutes', pomodoros: 1, tag: 'personal' },
      { title: 'Note 3 key takeaways from today’s reading', pomodoros: 1, tag: 'personal' },
      { title: 'Pick the next book (or chapter)', pomodoros: 1, tag: 'personal' },
    ],
  },
];

/** Look up a template by id; returns undefined for unknown ids. */
export function getTemplateById(id: string): GoalTemplate | undefined {
  return GOAL_TEMPLATES.find((t) => t.id === id);
}

/**
 * Render a template's `deadlineInDays` as an absolute YYYY-MM-DD
 * string anchored to today. Returns undefined when the template has
 * no deadline.
 *
 * Null-safe by design: a template with `deadlineInDays: null` (or 0)
 * leaves the goal deadline-less, mirroring the manual onboarding flow
 * where the deadline picker is optional.
 */
export function deadlineForTemplate(template: GoalTemplate): string | undefined {
  if (!template.deadlineInDays || template.deadlineInDays <= 0) return undefined;
  const target = new Date();
  target.setUTCDate(target.getUTCDate() + template.deadlineInDays);
  return target.toISOString().slice(0, 10);
}

/**
 * Days from today (UTC) to December 31 of the current year. Used by
 * the reading-goal template so "12 books this year" stays anchored
 * to the calendar year regardless of when the user signs up.
 *
 * Falls back to 30 days if the calendar math somehow returns a
 * non-positive number (Dec 31 just passed, edge of year boundary) so
 * we don't accidentally seed a deadline in the past.
 */
function daysUntilEndOfYear(): number {
  const now = new Date();
  const year = now.getUTCFullYear();
  const eoy = new Date(Date.UTC(year, 11, 31));
  const diffDays = Math.ceil((eoy.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 30;
}
