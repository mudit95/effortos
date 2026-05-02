// EffortOS Type Definitions

export interface User {
  id: string;
  name: string;
  email: string;
  timezone: string;
  created_at: string;
  onboarding_completed: boolean;
  avatar_url?: string;
  phone_number?: string;
  whatsapp_linked?: boolean;
  bot_persona?: BotPersona;
  /**
   * Streak-freeze tokens remaining for the current bucket (mig 035).
   * Free tier defaults to 1/month, Pro to 3/month. Decremented atomically
   * by the claim_freeze_token RPC when /api/streaks/freeze is called or
   * the auto-apply cron fires. Undefined for users created before the
   * migration was applied; the dashboard treats undefined as "tokens
   * unknown" and hides the freeze CTA until a refresh hydrates it.
   */
  freeze_tokens_remaining?: number;
  /** Last user-local calendar date with a completed focus session
   *  (mig 035). Drives the 7+ day lapse-recovery flow. */
  last_session_date?: string;
  /**
   * Selected focus-mode background (mig 036). NULL/undefined = solid
   * dark default. Bundled IDs match `focus-backgrounds` catalog;
   * 'custom:<storage-key>' references the focus-backgrounds storage
   * bucket.
   */
  focus_background_id?: string | null;
  /** Dim-overlay opacity (0–100, %) applied over the background so the
   *  timer stays readable. Default 35. */
  focus_background_dim?: number;
  settings: UserSettings;
}

/**
 * Voice the WhatsApp bot uses when talking to the user.
 *  - friend:    warm, casual, irreverent. Banter and emojis.
 *  - mentor:    thoughtful, growth-oriented, encouraging.
 *  - boss:      direct, results-driven, deadline-aware (in a fun way).
 *  - colleague: peer-to-peer, helpful, dry pragmatism.
 *
 * Picked during onboarding, surfaced in the welcome message, and used
 * by every coach/whatsapp message thereafter.
 */
export type BotPersona = 'friend' | 'mentor' | 'boss' | 'colleague';

export interface UserSettings {
  focus_duration: number;   // seconds (default 1500 = 25min)
  break_duration: number;   // seconds (default 300 = 5min)
  notifications_enabled: boolean;
  sound_enabled: boolean;
  theme: 'dark' | 'light';
}

export const DEFAULT_SETTINGS: UserSettings = {
  focus_duration: 25 * 60,
  break_duration: 5 * 60,
  notifications_enabled: true,
  sound_enabled: true,
  theme: 'dark',
};

export interface Goal {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  estimated_sessions_initial: number;
  estimated_sessions_current: number;
  sessions_completed: number;
  user_time_bias: number; // -2 to +2
  feedback_bias_log: FeedbackEntry[];
  experience_level: 'beginner' | 'intermediate' | 'advanced';
  daily_availability: number; // hours
  deadline?: string;
  consistency_level: 'low' | 'medium' | 'high';
  confidence_score: number;
  difficulty: 'easy' | 'moderate' | 'hard' | 'expert';
  recommended_sessions_per_day: number;
  estimated_days: number;
  milestones: Milestone[];
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  created_at: string;
  updated_at: string;
  completed_at?: string;
  paused_at?: string;
}

export interface Milestone {
  id: string;
  title: string;
  session_target: number;
  completed: boolean;
  completed_at?: string;
}

export interface Session {
  id: string;
  user_id: string;
  goal_id: string;
  start_time: string;
  end_time?: string;
  duration: number; // seconds
  status: 'active' | 'completed' | 'discarded' | 'paused';
  notes?: string;
  manual?: boolean;
  created_at: string;
}

export interface FeedbackEntry {
  timestamp: string;
  bias: number; // -2 to +2
  sessions_at_time: number;
}

export interface EstimationInput {
  goal: string;
  experience_level: 'beginner' | 'intermediate' | 'advanced';
  daily_availability: number;
  deadline?: string;
  consistency_level: 'low' | 'medium' | 'high';
  user_time_estimate?: number; // user's own estimate in hours
}

export interface EstimationOutput {
  goal: string;
  estimated_sessions: number;
  confidence_score: number;
  difficulty: 'easy' | 'moderate' | 'hard' | 'expert';
  recommended_sessions_per_day: number;
  estimated_days: number;
  milestones: Milestone[];
}

export interface RecalibrationResult {
  remaining_sessions: number;
  completion_date: string;
  daily_target: number;
  adaptive_factor: number;
  status: 'ahead' | 'on_track' | 'adjusting' | 'behind';
}

export interface DashboardStats {
  completion_percentage: number;
  sessions_done: number;
  sessions_remaining: number;
  total_hours: number;
  projected_completion: string;
  current_streak: number;
  longest_streak: number;
  pace_status: 'ahead' | 'on_track' | 'adjusting' | 'behind';
  daily_sessions: DailySession[];
}

export interface DailySession {
  date: string;
  count: number;
}

export type TimerState = 'idle' | 'running' | 'paused' | 'break' | 'completed';

export interface TimerConfig {
  focusDuration: number; // seconds (default 1500 = 25min)
  breakDuration: number; // seconds (default 300 = 5min)
}

export interface OnboardingData {
  goalTitle: string;
  motivation?: string;
  motivationNote?: string;
  experienceLevel: 'beginner' | 'intermediate' | 'advanced';
  dailyAvailability: number;
  deadline?: string;
  consistencyLevel: 'low' | 'medium' | 'high';
  userTimeEstimate?: number;
  userTimeBias: number;
  /** Selected bot persona (drives WhatsApp tone). Optional —
   *  falls back to 'friend' if the user skips the step. */
  botPersona?: BotPersona;
  /**
   * Goal-template id, when the user picked a quick-start archetype on
   * step 0. Drives two downstream behaviours: (1) the wizard auto-
   * advances past motivation/context/perception (since the template
   * already pre-filled them); (2) `completeOnboarding` seeds the
   * template's first daily tasks for today after the goal is created.
   * Undefined for users on the manual free-text path.
   * See `lib/goal-templates.ts` for the catalog.
   */
  templateId?: string;
}

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'warning' | 'error';
  duration?: number;
}

// Daily Grind types
export type DashboardMode = 'daily' | 'longterm' | 'reports';

// Layout for the Daily Grind view.
//   'list'     — classic ordered task list
//   'schedule' — 4-column drag-and-drop time-box grid
//   'flow'     — split: today's plan on the left, completed-session ledger on the right
export type DailyGrindLayout = 'list' | 'schedule' | 'flow';

export const TASK_TAGS = [
  { id: 'startup', label: 'Startup', color: '#c026d3' },
  { id: 'job', label: 'Job', color: '#0ea5e9' },
  { id: 'learning', label: 'Learning', color: '#22c55e' },
  { id: 'personal', label: 'Personal', color: '#f59e0b' },
  { id: 'health', label: 'Health', color: '#ef4444' },
  { id: 'creative', label: 'Creative', color: '#8b5cf6' },
] as const;

export type TaskTagId = typeof TASK_TAGS[number]['id'];

// Coarse time-boxing buckets used by the Schedule view. Kept as a union
// (not an enum) so it composes with `?:` for "unscheduled" without needing
// a sentinel value. Matches the CHECK constraint in migration 015.
export const TIME_BLOCKS = [
  { id: 'morning',   label: 'Morning',   hint: 'before noon'    },
  { id: 'afternoon', label: 'Afternoon', hint: 'noon – evening' },
  { id: 'evening',   label: 'Evening',   hint: 'after dinner'   },
] as const;

export type TimeBlock = typeof TIME_BLOCKS[number]['id'];

export interface DailyTask {
  id: string;
  title: string;
  completed: boolean;
  repeating: boolean;
  pomodoros_target: number;   // how many pomodoros planned for this task
  pomodoros_done: number;     // how many completed
  date: string;               // YYYY-MM-DD
  tag?: TaskTagId;            // effort category
  goal_id?: string;           // link to long-term goal
  time_block?: TimeBlock;     // coarse schedule bucket (Schedule view only)
  created_at: string;
  completed_at?: string;
  order: number;              // for sorting/reordering
}

export interface RepeatingTaskTemplate {
  id: string;
  title: string;
  pomodoros_target: number;
  tag?: TaskTagId;
  created_at: string;
  active: boolean;
}

// ── Journal ──────────────────────────────────────────────────────────
// One entry per calendar day per user, keyed by YYYY-MM-DD. Stored both
// in localStorage (anonymous users) and Supabase (cloud users). The
// UNIQUE(user_id, date) constraint in the DB enforces the "one per day"
// invariant so upsert-by-date is the natural operation.
export const JOURNAL_MOODS = [
  { id: 'great',  emoji: '😄', label: 'Great'  },
  { id: 'good',   emoji: '🙂', label: 'Good'   },
  { id: 'meh',    emoji: '😐', label: 'Meh'    },
  { id: 'rough',  emoji: '😟', label: 'Rough'  },
  { id: 'hard',   emoji: '😩', label: 'Hard'   },
] as const;

export type JournalMoodId = typeof JOURNAL_MOODS[number]['id'];

export interface JournalEntry {
  id: string;
  date: string;           // YYYY-MM-DD (local calendar date the entry is FOR)
  content: string;        // plain text, no markdown parsing yet
  mood?: JournalMoodId;
  // One-time AI-generated writing prompt. Once set, the "Ask for AI Prompt"
  // button is disabled for this entry — the prompt is a single marker the
  // user uses to write against, not a chat.
  ai_prompt?: string;
  /** Long-lived signed URL for an attached photo. Set when the entry was
   *  created via WhatsApp photo journal (mig 033). Null/undefined for
   *  text-only entries. The URL is signed for 1 year at write time;
   *  re-signing isn't wired yet (TODO when we hit users with year-old
   *  photos). */
  media_url?: string;
  /** MIME type of the attached photo. Mirror of journal_entries.media_type. */
  media_type?: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  created_at: string;
  updated_at: string;
}

// ── Shadow goals ─────────────────────────────────────────────────────
// The "someday shelf" — parked goal ideas the user wants to revisit
// without committing to estimation/scheduling yet. Intentionally a
// separate type from `Goal` because shadows carry no estimation,
// milestones, status machinery, or scheduling fields. A shadow can be
// "promoted" into a real goal via the onboarding flow, after which the
// shadow row is deleted.
export interface ShadowGoal {
  id: string;
  title: string;
  note: string;           // free-form context; may be empty
  created_at: string;
  updated_at: string;
}

// Subscription types
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'paused' | 'cancelled' | 'expired' | 'none';
export type PlanTier = 'starter' | 'pro';
/** Billing cadence for a subscription. Persisted in subscriptions.billing_cadence
 *  (migration 031). Fixed at /api/subscription/create time and not mutated
 *  later — switching cadence requires cancelling and re-subscribing. */
export type BillingCadence = 'monthly' | 'annual';

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  plan_tier: PlanTier;
  /** Defaults to 'monthly' when absent (covers admin-granted, implicit-trial,
   *  and pre-migration-031 rows). */
  billing_cadence?: BillingCadence;
  razorpay_subscription_id?: string;
  plan_id?: string;
  trial_ends_at?: string;    // ISO date
  current_period_end?: string; // ISO date
  cancelled_at?: string;
  created_at?: string;
}

// Coaching types (Pro tier)
export type CoachingIntensity = 'light' | 'balanced' | 'intense';

export type NudgeType =
  | 'morning_kickoff'
  | 'midday_checkin'
  | 'evening_wrapup'
  | 'streak_saver'
  | 'idle_detection'
  | 'goal_milestone'
  | 'weekly_recap'
  | 'pace_warning'
  | 'task_planning_prompt'
  | 'bad_day_check'
  | 'welcome'
  | 'plan_tomorrow'
  | 'eod_summary'
  | 'streak_protection'
  | 'weekly_reflection';

export interface CoachPreferences {
  coaching_intensity: CoachingIntensity;
  coaching_quiet_start: number; // hour 0-23, default 22
  coaching_quiet_end: number;   // hour 0-23, default 7
  coaching_paused_until?: string; // ISO date or null
}

export interface CoachLogEntry {
  id: string;
  user_id: string;
  nudge_type: NudgeType;
  message_sent: string;
  delivered: boolean;
  context_json?: Record<string, unknown>;
  created_at: string;
}

// ── Other To-Dos ─────────────────────────────────────────────────────
// A lightweight side-list of non-Pomodoro tasks ("Pick Susan up", "Pay
// the electricity bill"). Lives in its own table — these never enter
// the daily Pomodoro flow, the morning/afternoon emails, or session
// counts. The nightly recap mentions only the COUNT of open errands.
export interface OtherTodo {
  id: string;
  user_id: string;
  title: string;
  estimated_minutes: number | null; // null = no estimate
  completed: boolean;
  completed_at: string | null;
  sort_order: number; // ms epoch — higher = newer
  created_at: string;
}
