'use client';

import { create } from 'zustand';
import {
  User, Goal, Session, TimerState, OnboardingData,
  DashboardStats, RecalibrationResult, Toast, UserSettings,
  DashboardMode, DailyTask, DailySession, RepeatingTaskTemplate, TaskTagId,
  SubscriptionStatus, SubscriptionInfo, PlanTier, FeedbackEntry,
  JournalEntry, JournalMoodId,
  ShadowGoal, DailyGrindLayout,
} from '@/types';
import * as storage from '@/lib/storage';
import { estimateEffort, recalibrate, shouldTriggerFeedback, calculateTimeBias } from '@/lib/estimation';
import { getStreaks, sessionsToHours, generateId } from '@/lib/utils';
import { playSound } from '@/lib/sounds';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { resetProvider as resetDataLayerProvider } from '@/lib/dataLayer';
import * as api from '@/lib/api';
import {
  STARTER_PRICE_PER_MO,
  PRO_PRICE_PER_MO,
  STARTER_ANNUAL_PRICE_PER_YEAR,
  PRO_ANNUAL_PRICE_PER_YEAR,
} from '@/lib/pricing';
import { track } from '@/lib/analytics';
import {
  buildCoachContext,
  fetchPlanMyDay,
  fetchSessionDebrief,
  fetchWeeklyInsight,
  type PlanMyDayResponse,
  type SessionDebriefResponse,
  type WeeklyInsightResponse,
} from '@/lib/coachClient';

import { enqueueOffline, initOfflineSync } from '@/lib/offline-queue';
import { getTemplateById } from '@/lib/goal-templates';

// Module-level single-flight handle for initializeApp. The Supabase auth
// listener fires INITIAL_SESSION + SIGNED_IN + TOKEN_REFRESHED in close
// succession after a fresh login; without this guard, two parallel inits
// race on store writes and the user sees flaky "logged in / logged out"
// flicker. See initializeApp() below for the read/clear logic.
//
// `_initPromise` covers the in-flight case. `_lastInitFinishedAt` adds a
// short grace window AFTER an init completes — Supabase's auth burst can
// land additional events 50–200 ms after the first one, and re-running the
// whole init on each is wasted work that also briefly flickers the UI.
// Within INIT_DEBOUNCE_MS we treat the just-completed init as authoritative.
let _initPromise: Promise<void> | null = null;
let _lastInitFinishedAt = 0;
const INIT_DEBOUNCE_MS = 500;

/** Fire-and-forget Supabase write. Logs errors but never blocks.
 *  If the call fails while offline, optionally queues it for replay. */
function cloudSync(
  fn: () => Promise<unknown>,
  offlineFallback?: { url: string; method: 'POST' | 'PUT' | 'PATCH'; body: Record<string, unknown> },
): void {
  if (!isSupabaseConfigured()) return;
  fn().catch(err => {
    console.warn('Cloud sync failed:', err);
    // If we're offline and have a fallback route, queue it
    if (offlineFallback && typeof navigator !== 'undefined' && !navigator.onLine) {
      enqueueOffline(offlineFallback).catch(() => {});
    }
  });
}

// Initialize offline sync on module load (flushes queue when online)
if (typeof window !== 'undefined') {
  initOfflineSync();
}

// ── Onboarding draft persistence ──────────────────────────────────────────
//
// Without this, closing the tab mid-onboarding (or hitting the X button)
// wipes every entered field and the user is dropped back at step 0 with
// nothing pre-filled. For ProductHunt traffic that's a high-impact drop-off
// point. We mirror onboardingStep + onboardingData to localStorage on every
// edit and re-hydrate on app boot. Cleared at completion or logout.
const ONBOARDING_DRAFT_KEY = 'effortos_onboarding_draft';

function persistOnboardingDraft(state: { onboardingStep: number; onboardingData: unknown }): void {
  if (typeof window === 'undefined') return;
  try {
    const data = state.onboardingData as Record<string, unknown>;
    // If the draft is empty (just stepped to 0 with nothing entered) and
    // we're at step 0, drop the key — no point keeping a no-op stub.
    if (state.onboardingStep === 0 && (!data || Object.keys(data).length === 0)) {
      localStorage.removeItem(ONBOARDING_DRAFT_KEY);
      return;
    }
    localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify({ step: state.onboardingStep, data: state.onboardingData }),
    );
  } catch {
    // localStorage may be unavailable (private mode quotas, etc.) — fail
    // soft, the worst case is the user has to re-enter on tab reopen.
  }
}

function readOnboardingDraft(): { step: number; data: Record<string, unknown> } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ONBOARDING_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.step !== 'number' || typeof parsed?.data !== 'object') return null;
    return { step: parsed.step, data: parsed.data ?? {} };
  } catch {
    return null;
  }
}

function clearOnboardingDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(ONBOARDING_DRAFT_KEY);
  } catch { /* ignore */ }
}

interface AppState {
  // Auth
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Goals
  activeGoal: Goal | null;
  goals: Goal[];

  // Timer
  timerState: TimerState;
  timeRemaining: number;
  currentSessionId: string | null;
  isBreak: boolean;

  // Dashboard
  dashboardStats: DashboardStats | null;
  recalibrationResult: RecalibrationResult | null;

  // Feedback
  showFeedback: boolean;
  feedbackGoalId: string | null;

  // Session notes
  showSessionNotes: boolean;
  pendingSessionNotes: string | null;

  // Toasts
  toasts: Toast[];

  // Completion celebration
  showCelebration: boolean;

  // Goal history
  showGoalHistory: boolean;

  // Settings
  showSettings: boolean;

  // Manual session
  showManualSession: boolean;

  // Edit goal
  showEditGoal: boolean;

  // Exit confirmation (focus mode)
  showExitConfirm: boolean;

  // Remote timer (multi-device awareness)
  remoteTimerInfo: {
    device: string;
    isRunning: boolean;
    remaining: number;
    updatedAt: string;
  } | null;

  // Daily Grind
  dashboardMode: DashboardMode;
  dailyTasks: DailyTask[];
  repeatingTemplates: RepeatingTaskTemplate[];
  activeDailyTaskId: string | null;
  dailyViewDate: string; // YYYY-MM-DD
  // Layout within the Daily Grind view — 'list' (default) or 'schedule'.
  // Persisted to localStorage; not a cloud-synced preference (per-device
  // preference makes more sense here than per-account).
  dailyGrindLayout: DailyGrindLayout;

  // Journal
  // Hydrated from storage/cloud at init, then kept in sync on save/delete.
  // This is the full list (all dates) so the calendar can render an
  // indicator dot for every day that has an entry without extra fetches.
  journalEntries: JournalEntry[];
  // Date currently open in the JournalModal; null when the modal is closed.
  journalModalDate: string | null;

  // Plan Tomorrow modal
  showPlanTomorrow: boolean;

  // Shadow goals (someday shelf)
  // Loaded at init, kept in sync via add/update/delete/promote actions.
  shadowGoals: ShadowGoal[];
  // Controls visibility of the ShadowGoalsModal.
  showShadowGoals: boolean;
  // When a user clicks "Promote" on a shadow, we stash the shadow's id here
  // and route them through the onboarding flow. On successful goal creation
  // (`completeOnboarding` → `createNewGoal`) we clear this and delete the
  // corresponding shadow row. If the user bails out of onboarding, we leave
  // the shadow alone so they can promote it again later.
  pendingShadowGoalId: string | null;

  // Onboarding
  onboardingStep: number;
  onboardingData: Partial<OnboardingData>;

  // Subscription
  subscription: SubscriptionInfo;
  subscriptionLoading: boolean;
  showPaywall: boolean;

  // Reports deep-link
  reportGoalId: string | null;

  // AI Coach
  showAIPlanWizard: boolean;
  coachPlan: PlanMyDayResponse | null;
  coachPlanLoading: boolean;
  coachDebrief: SessionDebriefResponse | null;
  coachDebriefLoading: boolean;
  coachWeekly: WeeklyInsightResponse | null;
  coachWeeklyLoading: boolean;

  // View
  currentView: 'landing' | 'auth' | 'onboarding' | 'dashboard' | 'focus' | 'settings';

  // Connection / Supabase outage UX
  // 'unknown'  — pre-init, before we've successfully reached the cloud once.
  // 'ok'       — last cloud call succeeded; banner hidden.
  // 'degraded' — last cloud call failed (Supabase unreachable, fetch threw,
  //              status endpoint 5xx). Banner shows; the app keeps running
  //              from localStorage state. We never block the user.
  connectionStatus: 'unknown' | 'ok' | 'degraded';
  connectionLastError: string | null;
  setConnectionStatus: (status: 'unknown' | 'ok' | 'degraded', lastError?: string | null) => void;

  // Actions
  initializeApp: () => void;
  login: (name: string, email: string) => void;
  loginAsDemo: () => void;
  logout: () => void;

  setOnboardingStep: (step: number) => void;
  updateOnboardingData: (data: Partial<OnboardingData>) => void;
  completeOnboarding: () => void;

  createNewGoal: (data: OnboardingData) => Goal;
  updateGoalDetails: (goalId: string, title: string, description?: string) => void;
  deleteGoal: (goalId: string) => void;
  pauseGoal: (goalId: string) => void;
  resumeGoal: (goalId: string) => void;
  switchToGoal: (goalId: string) => void;
  updateGoalProgress: (goalId: string) => void;
  completeGoal: (goalId: string) => void;

  // Quick pomodoro — no auth, no goal, just a timer
  startQuickPomodoro: () => void;
  quickPomodoroComplete: boolean; // true after a quick pomodoro finishes (shows signup prompt)
  dismissQuickPomodoroPrompt: () => void;

  startTimer: () => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  tickTimer: () => void;
  completeTimerSession: () => void;
  skipBreak: () => void;
  resetTimer: () => void;

  submitFeedback: (bias: number) => void;
  dismissFeedback: () => void;

  submitSessionNotes: (notes: string) => void;
  dismissSessionNotes: () => void;

  addManualSession: (notes?: string) => void;

  updateSettings: (settings: Partial<UserSettings>) => void;
  /**
   * Update the user's anchor-habit text (mig 041). Pass null to clear.
   * Cap is 80 chars (CHECK at the DB level); store-side defensive trim.
   * Optimistic in-memory update + cloud sync via the profiles row.
   */
  updateAnchorHabit: (text: string | null) => Promise<void>;

  addToast: (message: string, type?: Toast['type']) => void;
  removeToast: (id: string) => void;

  // Daily Grind actions
  setDashboardMode: (mode: DashboardMode) => void;
  setDailyGrindLayout: (layout: DailyGrindLayout) => void;
  addDailyTask: (title: string, pomodorosTarget?: number, repeating?: boolean, tag?: TaskTagId, goalId?: string) => void;
  addDailyTaskForDate: (title: string, date: string, pomodorosTarget?: number, repeating?: boolean, tag?: TaskTagId, goalId?: string) => void;
  toggleTaskComplete: (taskId: string) => void;
  deleteDailyTask: (taskId: string) => void;
  /** Reorder pending tasks for a given date by an explicit ordering of
   *  task ids. Updates each task's `order` field in store, localStorage,
   *  and (via cloudSync) Supabase. The list is the new "pending" order;
   *  completed tasks keep their existing order untouched. */
  reorderDailyTasks: (date: string, orderedIds: string[]) => void;
  setActiveDailyTask: (taskId: string | null) => void;
  completeDailyPomodoro: () => void;
  setDailyViewDate: (date: string) => void;
  refreshDailyTasks: () => void;
  removeRepeatingTemplate: (templateId: string) => void;
  updateDailyTaskDetails: (taskId: string, updates: Partial<DailyTask>) => void;

  // Journal actions
  // Open the JournalModal for the given YYYY-MM-DD, or close it by passing null.
  setJournalModalDate: (date: string | null) => void;
  // Upsert a journal entry keyed by date. Optimistically updates the in-memory
  // list, then syncs to localStorage + cloud. One call serves "create" and
  // "update" because the DB enforces UNIQUE(user_id, date).
  saveJournalEntry: (date: string, content: string, mood?: JournalMoodId) => void;
  // Remove the entry for a given date. No-op if no entry exists for that date.
  deleteJournalEntry: (date: string) => void;
  // Ask the AI coach for a one-time journal-writing prompt for the given
  // date. Returns the generated prompt on success, or null if already set
  // (caller is expected to read the existing `ai_prompt` in that case).
  // Falls back to a curated static prompt if the API call fails. The
  // resulting prompt is persisted to state, localStorage, and cloud.
  requestJournalAIPrompt: (date: string) => Promise<string | null>;

  // Shadow goal actions
  setShowShadowGoals: (show: boolean) => void;
  setShowPlanTomorrow: (show: boolean) => void;
  addShadowGoal: (title: string, note?: string) => void;
  updateShadowGoal: (id: string, patch: { title?: string; note?: string }) => void;
  removeShadowGoal: (id: string) => void;
  // "Promote" means: park the shadow's id in `pendingShadowGoalId`, prefill
  // onboarding with its title/note, and route the user into onboarding. The
  // shadow row is not removed until the goal is actually created.
  promoteShadowGoal: (id: string) => void;

  // Subscription
  fetchSubscriptionStatus: () => void;
  startTrial: (opts?: { tier?: PlanTier; cadence?: 'monthly' | 'annual'; couponCode?: string; couponId?: string; offerId?: string }) => void;
  cancelSubscription: () => void;
  /**
   * Pause the active subscription. Calls /api/subscription/pause; on
   * success flips local subscription.status to 'paused' so PremiumGate
   * gates the user out without waiting for a fetchSubscriptionStatus.
   * Surfaces a toast on failure (e.g., past_due → must fix payment first).
   */
  pauseSubscription: () => void;
  /** Resume from paused. Mirrors pauseSubscription's pattern. */
  resumeSubscription: () => void;
  /**
   * Freeze a calendar day to protect the streak (mig 035).
   * `date` defaults to 'today'; 'yesterday' uses the 24h retroactive
   * window. On success, optimistically updates user.freeze_tokens_remaining
   * and surfaces a toast. On failure (no tokens, already frozen, beyond
   * window) surfaces an error toast and leaves state unchanged.
   */
  freezeStreak: (date?: 'today' | 'yesterday') => void;
  /**
   * Update focus-mode background preference (mig 036).
   *   - id:  bundled background id, 'custom:<key>', or null to clear.
   *   - dim: 0-100 opacity of the dim scrim, optional (only one
   *          field may be set per call — pass {dim} alone to keep
   *          the current id).
   * Updates user state optimistically and persists via cloudSync.
   */
  setFocusBackground: (opts: { id?: string | null; dim?: number }) => void;
  setShowPaywall: (show: boolean) => void;
  isSubscriptionActive: () => boolean;
  isProTier: () => boolean;

  // Reports
  setReportGoalId: (goalId: string | null) => void;
  openGoalReport: (goalId: string) => void;

  // AI Coach actions
  setShowAIPlanWizard: (show: boolean) => void;
  requestPlanMyDay: (intake?: { hoursAvailable: number; priorities: string }) => void;
  requestSessionDebrief: (sessionNumber: number, totalForGoal: number, taskTitle?: string, notes?: string) => void;
  requestWeeklyInsight: (weekSessions: Session[], previousWeekCount: number) => void;
  dismissCoachPlan: () => void;
  dismissCoachDebrief: () => void;
  dismissCoachWeekly: () => void;

  refreshDashboard: () => void;
  setView: (view: AppState['currentView']) => void;
  setShowCelebration: (show: boolean) => void;
  setShowGoalHistory: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setShowManualSession: (show: boolean) => void;
  setShowEditGoal: (show: boolean) => void;
  setShowExitConfirm: (show: boolean) => void;

  setRemoteTimerInfo: (info: AppState['remoteTimerInfo']) => void;

  requestNotificationPermission: () => void;
  sendNotification: (title: string, body: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  // Initial state
  user: null,
  isAuthenticated: false,
  isLoading: true,
  activeGoal: null,
  goals: [],
  timerState: 'idle',
  timeRemaining: 25 * 60,
  currentSessionId: null,
  isBreak: false,
  dashboardStats: null,
  recalibrationResult: null,
  showFeedback: false,
  feedbackGoalId: null,
  showSessionNotes: false,
  pendingSessionNotes: null,
  toasts: [],
  showCelebration: false,
  showGoalHistory: false,
  showSettings: false,
  showManualSession: false,
  showEditGoal: false,
  showExitConfirm: false,
  remoteTimerInfo: null,
  // Default to 'daily' — the task list is the new hero. Long-term goals
  // and reports stay one tap away via the top-nav switcher, but a fresh
  // session should never land in an empty long-term view. The prior
  // default ('longterm') showed brand-new users a "No active goal" empty
  // state, which fights the pivot to a task-list-first product.
  dashboardMode: 'daily',
  dailyTasks: [],
  repeatingTemplates: [],
  activeDailyTaskId: null,
  dailyViewDate: (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })(),
  // Hydrated synchronously from localStorage in initializeApp; 'list' here is
  // just the sane default for first-render-before-hydration.
  dailyGrindLayout: 'list',
  journalEntries: [],
  journalModalDate: null,
  showPlanTomorrow: false,
  shadowGoals: [],
  showShadowGoals: false,
  pendingShadowGoalId: null,
  subscription: { status: 'none' as SubscriptionStatus, plan_tier: 'starter' as PlanTier },
  subscriptionLoading: true,
  showPaywall: false,
  reportGoalId: null,
  showAIPlanWizard: false,
  coachPlan: null,
  coachPlanLoading: false,
  coachDebrief: null,
  coachDebriefLoading: false,
  coachWeekly: null,
  coachWeeklyLoading: false,
  onboardingStep: 0,
  onboardingData: {},
  currentView: 'landing',
  quickPomodoroComplete: false,
  connectionStatus: 'unknown',
  connectionLastError: null,

  setConnectionStatus: (status, lastError = null) => {
    // Avoid noisy re-renders: only update if state actually changed.
    const cur = get();
    if (cur.connectionStatus === status && cur.connectionLastError === lastError) return;
    set({ connectionStatus: status, connectionLastError: lastError });
  },

  initializeApp: async () => {
    // ── Single-flight guard ────────────────────────────────────────────
    // Multiple Supabase auth events (INITIAL_SESSION, SIGNED_IN,
    // TOKEN_REFRESHED) used to each trigger initializeApp() in parallel.
    // The two runs raced on store writes — whichever finished second
    // clobbered the first. That manifested as "auth sometimes works,
    // sometimes doesn't" and stale data after sign-in. Now we de-dupe:
    // a second call while one is in flight just awaits the in-flight
    // promise instead of starting a duplicate run.
    if (_initPromise) {
      return _initPromise;
    }

    // Debounce: if a previous init JUST finished, treat its output as
    // authoritative and skip. Supabase fires INITIAL_SESSION + SIGNED_IN
    // back-to-back at OAuth callback time and only the first call needs
    // to hit the wire. Without this guard, the second event triggers a
    // full re-init that sometimes briefly flickers `isLoading` true and
    // can clobber an in-progress UI transition.
    if (_lastInitFinishedAt && Date.now() - _lastInitFinishedAt < INIT_DEBOUNCE_MS) {
      return;
    }

    // If user explicitly logged out (currentView === 'landing' and not loading), skip re-init
    const currentState = get();
    if (currentState.currentView === 'landing' && !currentState.isLoading && !currentState.isAuthenticated) {
      return;
    }

    _initPromise = (async () => {
      let _isCloud = false;

    try {
    // Check Supabase session first (only if configured)
    if (isSupabaseConfigured()) try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      // ── Anonymous visitor fast path ───────────────────────────────
      // If getSession() returns null AND we're not in the middle of an
      // OAuth callback (`?code=` in the URL), we *know* the visitor is
      // anonymous. Drop them on the landing page immediately rather
      // than waiting up to 8 seconds for an auth listener that's
      // never going to fire.
      //
      // The previous behaviour:
      //   1. getSession() → null (cold-start serverless, 1-3 s)
      //   2. fall through to "Supabase configured" branch below
      //   3. set 8 s safety timer
      //   4. visitor sees BootLoader's "stalled" modal at 6 s
      //   5. landing page finally renders at 8 s
      // After this fix, anonymous visitors see landing in ~500 ms.
      // OAuth callbacks (?code=) still take the slower path because
      // exchangeCodeForSession runs after this point and the auth
      // listener will re-trigger initializeApp once the session is set.
      if (!session?.user) {
        const hasOAuthCode =
          typeof window !== 'undefined' &&
          /[?&]code=/.test(window.location.search);
        if (!hasOAuthCode) {
          set({ isLoading: false, currentView: 'landing', user: null, isAuthenticated: false });
          get().setConnectionStatus('ok');
          return;
        }
      }

      if (session?.user) {
        _isCloud = true;

        // Fetch profile from Supabase
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (profile) {
          // Auto-detect timezone if the profile doesn't have one yet
          let timezone = profile.timezone || 'UTC';
          if (typeof window !== 'undefined' && (!profile.timezone || profile.timezone === 'UTC' || profile.timezone === 'Asia/Kolkata')) {
            try {
              const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
              if (detected && detected !== profile.timezone) {
                timezone = detected;
                // Persist detected timezone to profile + email_preferences (fire-and-forget)
                supabase.from('profiles').update({ timezone: detected }).eq('id', profile.id).then(() => {});
                fetch('/api/email-preferences', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ timezone: detected }),
                }).catch(() => {});
              }
            } catch { /* ignore */ }
          }

          // Convert Supabase profile to local User shape
          const supaUser = {
            id: profile.id,
            name: profile.name || session.user.user_metadata?.name || '',
            email: profile.email || session.user.email || '',
            timezone,
            created_at: profile.created_at,
            onboarding_completed: profile.onboarding_completed,
            avatar_url: profile.avatar_url,
            phone_number: profile.phone_number || '',
            whatsapp_linked: profile.whatsapp_linked || false,
            bot_persona: profile.bot_persona || undefined,
            // Profile metadata used by behavioral / lapse / focus features.
            freeze_tokens_remaining: profile.freeze_tokens_remaining,
            last_session_date: profile.last_session_date,
            focus_background_id: profile.focus_background_id,
            focus_background_dim: profile.focus_background_dim,
            anchor_habit_text: profile.anchor_habit_text,
            settings: {
              focus_duration: profile.focus_duration,
              break_duration: profile.break_duration,
              notifications_enabled: profile.notifications_enabled,
              sound_enabled: profile.sound_enabled,
              theme: profile.theme as 'dark' | 'light',
            },
          };

          // Also save to localStorage for offline/fast access
          storage.setUser(supaUser);

          // Fire-and-forget: send the welcome email on first cloud bootstrap.
          // The endpoint is idempotent (checks email_log + account age), so it's
          // safe to call on every boot; but the round-trip itself is wasted
          // after the first success. Cache a per-user "already attempted"
          // flag in localStorage so subsequent boots skip the call entirely.
          // Falls back to the server-side check on first install on a new
          // device. (Falls through cleanly on private mode / SSR boundary.)
          if (typeof window !== 'undefined') {
            const cacheKey = `effortos:welcomeEmailDone:${supaUser.id}`;
            let alreadyDone = false;
            try {
              alreadyDone = localStorage.getItem(cacheKey) === '1';
            } catch {
              // localStorage unavailable — fall through and call the server
              // (it'll still bail out idempotently).
            }
            if (!alreadyDone) {
              fetch('/api/account/welcome-email', { method: 'POST' })
                .then(() => {
                  try { localStorage.setItem(cacheKey, '1'); } catch { /* ignore */ }
                })
                .catch(() => { /* idempotent — no retry needed */ });
            }
          }

          // ── Cloud path: load data from Supabase ──
          // Keep localStorage goals cached as an offline fallback — we only
          // overwrite it after a successful cloud fetch, never clear it
          // eagerly. Clearing eagerly caused a race on page refresh where a
          // transient auth hiccup would fall through to the localStorage path
          // with zero goals and incorrectly open the onboarding flow.
          const cachedGoals: Goal[] = (() => {
            try { return storage.getGoals(); } catch { return []; }
          })();

          // Load daily grind state — pure local reads, no network needed.
          const dashboardMode = storage.getDashboardMode();
          const dailyGrindLayout = storage.getDailyGrindLayout();
          const todayKey = new Date().toISOString().split('T')[0];

          // Parallelise the five cloud fetches. They used to run sequentially
          // (5× round-trip ≈ 1.5–3 s on cold-start latency); now they run
          // concurrently and the boot completes in roughly the slowest single
          // call (≈ 300–500 ms). Each individual fetch falls back to its
          // localStorage cache on failure, so a single slow endpoint can't
          // sink the whole boot.
          const [
            goalsRes,
            dailyTasksRes,
            templatesRes,
            journalRes,
            shadowRes,
          ] = await Promise.allSettled([
            api.getGoals(),
            api.getDailyTasksForDate(todayKey),
            api.getRepeatingTemplates(),
            api.getJournalEntries(),
            api.getShadowGoals(),
          ]);

          const cloudGoals: Goal[] = goalsRes.status === 'fulfilled'
            ? goalsRes.value
            : cachedGoals;
          const dailyTasks: DailyTask[] = dailyTasksRes.status === 'fulfilled'
            ? dailyTasksRes.value
            : storage.ensureRepeatingTasksForDate(todayKey);
          const repeatingTemplates: RepeatingTaskTemplate[] = templatesRes.status === 'fulfilled'
            ? templatesRes.value
            : storage.getRepeatingTemplates().filter(t => t.active);
          const journalEntries: JournalEntry[] = journalRes.status === 'fulfilled'
            ? journalRes.value
            : storage.getJournalEntries();
          const shadowGoals: ShadowGoal[] = shadowRes.status === 'fulfilled'
            ? shadowRes.value
            : storage.getShadowGoals();

          const cloudActiveGoal = cloudGoals.find(g => g.status === 'active') || null;
          const focusDuration = supaUser.settings?.focus_duration || 25 * 60;

          // Recover timer state from localStorage (instant, no network).
          //
          // Both running-saves and paused-saves are rehydrated, capped at
          // a 12-hour TTL — older saves are almost always abandoned
          // sessions, and resurfacing a day-old timer creates more
          // confusion than continuity. The rehydrated state is always
          // 'paused' so the user explicitly confirms before continuing.
          const timerSaved = storage.getTimerState();
          let timeRemaining = focusDuration;
          let timerState: TimerState = 'idle';
          let currentSessionId: string | null = null;

          const TIMER_REHYDRATE_TTL_MS = 12 * 60 * 60 * 1000;
          if (
            timerSaved &&
            cloudActiveGoal &&
            Date.now() - timerSaved.savedAt < TIMER_REHYDRATE_TTL_MS
          ) {
            // For running saves, subtract wall-clock elapsed since save.
            // For paused saves, the saved `remaining` is verbatim — pause
            // means time didn't advance, so no elapsed subtraction.
            const remaining = timerSaved.isRunning
              ? timerSaved.remaining - Math.floor((Date.now() - timerSaved.savedAt) / 1000)
              : timerSaved.remaining;
            if (remaining > 0) {
              timeRemaining = remaining;
              timerState = 'paused';
              currentSessionId = timerSaved.sessionId || null;
            }
          }

          // Also cache goals to localStorage for offline access
          // (storage.setGoals doesn't exist, but individual goal data is cached via the store)

          set({
            user: supaUser,
            isAuthenticated: true,
            isLoading: false,
            goals: cloudGoals,
            activeGoal: cloudActiveGoal,
            timeRemaining,
            timerState,
            currentSessionId,
            dashboardMode,
            dailyGrindLayout,
            dailyTasks,
            repeatingTemplates,
            dailyViewDate: todayKey,
            journalEntries,
            shadowGoals,
            // Priority order:
            //   1. If a session was active before the reload (we
            //      hydrate it into 'paused' state with a real
            //      currentSessionId — see the timerSaved block
            //      above), restore the user to FOCUS MODE. Biggest
            //      UX win for mobile users whose tab got killed
            //      mid-session — they come back to where they left
            //      off, not the dashboard.
            //   2. Active goal → dashboard.
            //   3. If onboarded or has any goals → dashboard.
            //   4. Brand-new user → onboarding.
            currentView:
              currentSessionId && timerState === 'paused'
                ? 'focus'
                : cloudActiveGoal
                  ? 'dashboard'
                  : (supaUser.onboarding_completed || cloudGoals.length > 0)
                    ? 'dashboard'
                    : 'onboarding',
          });

          if (cloudActiveGoal) get().refreshDashboard();
          // We reached Supabase, read the profile, and rehydrated state.
          // That's the strongest signal of cloud-tier health we get on boot.
          get().setConnectionStatus('ok');
          // Fetch subscription status in background
          get().fetchSubscriptionStatus();
          return; // Done — skip localStorage path below
        }
      }
    } catch (err) {
      // Supabase unavailable — fall back to localStorage. Surface this so the
      // <ConnectionBanner> can warn the user that today's writes won't sync
      // until the cloud is reachable. The app keeps running from local state.
      console.warn('Supabase session check failed, using localStorage:', err);
      get().setConnectionStatus(
        'degraded',
        err instanceof Error ? err.message : 'Cloud unreachable',
      );
    }

    // ── Local path: load data from localStorage ──
    // Reset data layer provider cache
    resetDataLayerProvider();

    // If Supabase IS configured, NEVER fall through to the localStorage path
    // below. We only reach this branch if cloud hydration didn't fully succeed
    // (no session yet, profile fetch failed, etc.). The localStorage path can
    // incorrectly open onboarding when the cache is empty or stale. Instead,
    // stop here and let the auth state listener (INITIAL_SESSION / SIGNED_IN /
    // TOKEN_REFRESHED) re-run initializeApp once the session is ready.
    //
    // If we already have a hydrated user in memory, keep them on the dashboard
    // rather than showing the loading spinner forever — a previous successful
    // init likely populated state, and a transient refresh re-init shouldn't
    // knock them off the dashboard.
    if (isSupabaseConfigured()) {
      const existing = get();
      if (existing.isAuthenticated && existing.user) {
        // Already hydrated — nothing more to do.
        set({ isLoading: false });
        return;
      }
      // Not yet hydrated — wait for auth listener to re-trigger.
      // Safety net: if still loading after 8 seconds, show landing page
      // so the user isn't stuck on a forever-spinner. 8s (was 3s) gives
      // cold-start Vercel functions enough time to finish the
      // exchangeCodeForSession + profile fetch before we give up. The
      // BootLoader's "stalled" state already shows a slow-connection
      // message at 6s, so there's user-facing feedback well before this.
      setTimeout(() => {
        const s = get();
        if (s.isLoading && !s.isAuthenticated) {
          set({ isLoading: false, currentView: 'landing' });
        }
      }, 8000);
      return;
    }

    const user = storage.getUser();
    if (user) {
      const goals = storage.getGoals();
      const activeGoal = goals.find(g => g.status === 'active') || null;
      const focusDuration = user.settings?.focus_duration || 25 * 60;

      // Recover timer state — same 12-hour TTL semantics as the cloud
      // path above. Paused saves are restored too (previously they were
      // silently dropped, so a pause that crossed a refresh vanished and
      // the user lost the session).
      const timerSaved = storage.getTimerState();
      let timeRemaining = focusDuration;
      let timerState: TimerState = 'idle';
      let currentSessionId: string | null = null;

      const TIMER_REHYDRATE_TTL_MS = 12 * 60 * 60 * 1000;
      if (
        timerSaved &&
        activeGoal &&
        Date.now() - timerSaved.savedAt < TIMER_REHYDRATE_TTL_MS
      ) {
        const remaining = timerSaved.isRunning
          ? timerSaved.remaining - Math.floor((Date.now() - timerSaved.savedAt) / 1000)
          : timerSaved.remaining;
        if (remaining > 0) {
          timeRemaining = remaining;
          timerState = 'paused';
          currentSessionId = timerSaved.sessionId || null;
        }
      }

      // Load daily grind state
      const dashboardMode = storage.getDashboardMode();
      const dailyGrindLayout = storage.getDailyGrindLayout();
      const todayKey = new Date().toISOString().split('T')[0];
      const dailyTasks = storage.ensureRepeatingTasksForDate(todayKey);
      const repeatingTemplates = storage.getRepeatingTemplates().filter(t => t.active);
      const journalEntries = storage.getJournalEntries();
      const shadowGoals = storage.getShadowGoals();

      set({
        user,
        isAuthenticated: true,
        isLoading: false,
        goals,
        activeGoal,
        timeRemaining,
        timerState,
        currentSessionId,
        dashboardMode,
        dailyGrindLayout,
        dailyTasks,
        repeatingTemplates,
        dailyViewDate: todayKey,
        journalEntries,
        shadowGoals,
        // Same rehydrate-into-focus-mode rule as the cloud path —
        // mid-session refresh should land back in focus mode, not
        // bounce to dashboard.
        currentView:
          currentSessionId && timerState === 'paused'
            ? 'focus'
            : activeGoal
              ? 'dashboard'
              : goals.length > 0 ? 'dashboard' : 'onboarding',
      });

      // Hydrate any pending onboarding draft (saved if the user closed the
      // tab mid-flow). Only relevant if we're routing to 'onboarding' —
      // for users who already have a goal we deliberately ignore the
      // draft so a stale partial fill doesn't reappear weeks later.
      if (!activeGoal && goals.length === 0) {
        const draft = readOnboardingDraft();
        if (draft) {
          set({
            onboardingStep: draft.step,
            onboardingData: draft.data as Partial<OnboardingData>,
          });
        }
      }

      if (activeGoal) get().refreshDashboard();
    } else {
      set({ isLoading: false, currentView: 'landing' });
    }
    } catch (fatalErr) {
      // Global safety net — if anything in init crashes, show landing page
      console.error('App initialization failed:', fatalErr);
      set({ isLoading: false, currentView: 'landing', user: null, isAuthenticated: false });
    }
    })();

    try {
      await _initPromise;
    } finally {
      // Always clear the in-flight handle so the next legitimate trigger
      // (e.g. SIGNED_IN after the user returns from another tab) can run.
      // We also stamp _lastInitFinishedAt for the debounce-grace check at
      // the top of this function — that's what neutralises the auth-event
      // burst that fires right after OAuth callback completes.
      _initPromise = null;
      _lastInitFinishedAt = Date.now();
    }
  },

  login: (name: string, email: string) => {
    const user = storage.createDemoUser(name, email);
    set({
      user,
      isAuthenticated: true,
      currentView: 'onboarding',
      onboardingStep: 0,
    });
  },

  loginAsDemo: () => {
    const user = storage.createDemoUser('Explorer', 'demo@effortos.app');
    // Create a demo goal so they can try the timer immediately
    set({ user, isAuthenticated: true });

    const goal = get().createNewGoal({
      goalTitle: 'Try a focus session',
      experienceLevel: 'intermediate',
      dailyAvailability: 2,
      consistencyLevel: 'medium',
      userTimeBias: 0,
    });

    storage.updateUser({ onboarding_completed: true });
    set({
      user: { ...user, onboarding_completed: true },
      activeGoal: goal,
      currentView: 'dashboard',
    });
    get().refreshDashboard();
    get().addToast('Welcome! Try starting a focus session.', 'info');
  },

  logout: async () => {
    // Reset state FIRST to show landing page immediately
    set({
      user: null,
      isAuthenticated: false,
      activeGoal: null,
      goals: [],
      dailyTasks: [],
      repeatingTemplates: [],
      journalEntries: [],
      journalModalDate: null,
      shadowGoals: [],
      showShadowGoals: false,
      pendingShadowGoalId: null,
      dailyGrindLayout: 'list',
      timerState: 'idle',
      timeRemaining: 25 * 60,
      currentSessionId: null,
      dashboardStats: null,
      isBreak: false,
      showFeedback: false,
      feedbackGoalId: null,
      showSessionNotes: false,
      showCelebration: false,
      coachPlan: null,
      coachDebrief: null,
      coachWeekly: null,
      currentView: 'landing',
      isLoading: false,
    });

    // Then clear storage and sign out in background
    try { storage.clearAllData(); } catch (e) {
      // Log so we know if a user reports lingering data after logout
      console.error('[logout] storage.clearAllData failed:', e);
    }
    // Drop any half-finished onboarding draft so the next user on this
    // device doesn't see the previous user's pre-filled goal title.
    clearOnboardingDraft();
    // Reset the init-debounce timestamp so a logout-then-login within
    // 500ms re-runs initializeApp from scratch. Without this reset,
    // the new user would inherit the previous user's hydrated store
    // for the debounce window — a real cross-user data leak in
    // shared-device scenarios.
    _lastInitFinishedAt = 0;
    if (isSupabaseConfigured()) try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (e) {
      // Continue even if Supabase signOut fails — local state is
      // already cleared above. Log so we can see if signOut is
      // routinely failing for some users.
      console.error('[logout] supabase.signOut failed:', e);
    }
  },

  setOnboardingStep: (step) => {
    set({ onboardingStep: step });
    // Persist so closing the tab mid-flow doesn't lose the user's place.
    persistOnboardingDraft(get());
  },

  updateOnboardingData: (data) => {
    set(state => ({
      onboardingData: { ...state.onboardingData, ...data },
    }));
    persistOnboardingDraft(get());
  },

  completeOnboarding: () => {
    const { onboardingData, user, pendingShadowGoalId } = get();
    if (!user || !onboardingData.goalTitle) return;

    let goal: Goal;
    try {
      goal = get().createNewGoal(onboardingData as OnboardingData);
    } catch {
      // Max goals reached — go back to dashboard. Leave the shadow alone:
      // the user didn't actually consume the shelf entry, so it should
      // still be there waiting if they free up a slot.
      set({ currentView: 'dashboard', onboardingStep: 0, onboardingData: {} });
      clearOnboardingDraft();
      return;
    }
    storage.updateUser({ onboarding_completed: true });
    // Sync onboarding_completed flag — and the chosen bot persona —
    // to Supabase. Persona persists here even when the user *skips*
    // the WhatsApp step, so if they later link from Settings the bot
    // already knows the voice they picked during onboarding. The
    // verify endpoint also writes persona on confirm, so the two
    // paths converge to the same column.
    const personaForSync = onboardingData.botPersona;
    cloudSync(async () => {
      const supabase = createClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const update: Record<string, unknown> = { onboarding_completed: true };
        if (personaForSync) update.bot_persona = personaForSync;
        await supabase.from('profiles').update(update).eq('id', authUser.id);
      }
    });

    // If this onboarding run was a "promote shadow" flow, the shadow's job
    // is done — remove it from the shelf now that it has a real goal.
    if (pendingShadowGoalId) {
      get().removeShadowGoal(pendingShadowGoalId);
    }

    // Quick-start template path: seed today's first three daily tasks
    // straight from the template so the user lands on the dashboard
    // with something to do, not an empty list. This is the activation
    // half of the templates feature — picking a template gets you a
    // goal, but only the seeded tasks get you to a focus session in
    // <30 seconds. addDailyTask handles storage + cloudSync; the goal
    // id link makes the tasks count toward goal progress.
    if (onboardingData.templateId) {
      const template = getTemplateById(onboardingData.templateId);
      if (template) {
        for (const seed of template.seedTasks) {
          get().addDailyTask(seed.title, seed.pomodoros, false, seed.tag, goal.id);
        }
      }
    }

    set({
      user: {
        ...user,
        onboarding_completed: true,
        // If the user picked a persona during onboarding (and the
        // verify flow hasn't already mirrored it), reflect it here so
        // the dashboard / settings UI see the chosen voice immediately.
        bot_persona: personaForSync ?? user.bot_persona,
      },
      activeGoal: goal,
      currentView: 'dashboard',
      onboardingStep: 0,
      onboardingData: {},
      pendingShadowGoalId: null,
    });
    clearOnboardingDraft();

    // Auto-redeem a pending referral code captured at landing (?ref=CODE).
    // Stashed by useStashReferralCode hook in LandingPage. We fire-and-
    // forget — failure is fine; the user can still paste the code later
    // in the paywall modal. The code is cleared regardless so a failed
    // redemption doesn't replay on every subsequent dashboard mount.
    if (typeof window !== 'undefined') {
      try {
        const pending = window.localStorage.getItem('effortos:pending_referral');
        if (pending) {
          window.localStorage.removeItem('effortos:pending_referral');
          fetch('/api/coupons/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: pending }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (data?.applied === 'free_months') {
                get().addToast(
                  `Referral applied — ${data.value} month${data.value === 1 ? '' : 's'} free!`,
                  'success',
                );
                get().fetchSubscriptionStatus();
              }
            })
            .catch(() => {
              // Silent fail — user can still paste the code manually.
            });
        }
      } catch {
        // localStorage unavailable — skip silently.
      }
    }

    get().refreshDashboard();
  },

  createNewGoal: (data: OnboardingData) => {
    const { user } = get();
    if (!user) throw new Error('No user');

    // Enforce 5 active goal limit
    const currentGoals = get().goals;
    const activeGoals = currentGoals.filter(g => g.status === 'active' || g.status === 'paused');
    if (activeGoals.length >= 5) {
      get().addToast('Maximum 5 active goals allowed. Pause or complete a goal first.', 'warning');
      throw new Error('Max goals reached');
    }

    const estimation = estimateEffort({
      goal: data.goalTitle,
      experience_level: data.experienceLevel,
      daily_availability: data.dailyAvailability,
      deadline: data.deadline,
      consistency_level: data.consistencyLevel,
      user_time_estimate: data.userTimeEstimate,
    });

    const timeBias = calculateTimeBias(data.userTimeEstimate, estimation.estimated_sessions);

    const goalData = {
      user_id: user.id,
      title: data.goalTitle,
      estimated_sessions_initial: estimation.estimated_sessions,
      estimated_sessions_current: estimation.estimated_sessions,
      sessions_completed: 0,
      user_time_bias: timeBias,
      feedback_bias_log: [],
      experience_level: data.experienceLevel,
      daily_availability: data.dailyAvailability,
      deadline: data.deadline,
      consistency_level: data.consistencyLevel,
      confidence_score: estimation.confidence_score,
      difficulty: estimation.difficulty,
      recommended_sessions_per_day: estimation.recommended_sessions_per_day,
      estimated_days: estimation.estimated_days,
      milestones: estimation.milestones,
      status: 'active' as const,
    };

    // Store-first: build goal object, update Zustand directly
    const goal: Goal = {
      ...goalData,
      id: generateId(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const updatedGoals = [...get().goals, goal];
    set({ goals: updatedGoals, activeGoal: goal });

    // Sync to localStorage (offline cache) and cloud
    // Note: we push the exact goal object (with our generated ID) to avoid ID mismatch
    try {
      const lsGoals = storage.getGoals();
      lsGoals.push(goal);
      localStorage.setItem('effortos_goals', JSON.stringify(lsGoals));
    } catch { /* localStorage may be unavailable */ }
    // CRITICAL: pass the local id so Supabase doesn't auto-generate a
    // different one. Without this, every subsequent api.updateGoal(goal.id, ...)
    // — milestone bumps, sessions_completed increments, status changes —
    // targets a non-existent row in cloud and silently no-ops until reload.
    cloudSync(() => api.createGoal({ ...goalData, id: goal.id }));

    return goal;
  },

  updateGoalDetails: (goalId, title, description) => {
    // Store-first: update in Zustand directly
    const updatedGoals = get().goals.map(g =>
      g.id === goalId ? { ...g, title, description, updated_at: new Date().toISOString() } : g
    );
    const updatedGoal = updatedGoals.find(g => g.id === goalId) || get().activeGoal;
    set({ activeGoal: updatedGoal, goals: updatedGoals, showEditGoal: false });
    get().addToast('Goal updated', 'success');
    storage.updateGoal(goalId, { title, description });
    cloudSync(() => api.updateGoal(goalId, { title, description }));
  },

  deleteGoal: (goalId) => {
    // Update store directly (source of truth for cloud users)
    const updatedGoals = get().goals.map(g =>
      g.id === goalId ? { ...g, status: 'abandoned' as const, updated_at: new Date().toISOString() } : g
    );
    const visibleGoals = updatedGoals.filter(g => g.status !== 'abandoned');
    const { activeGoal } = get();
    const newActive = activeGoal?.id === goalId
      ? (visibleGoals.find(g => g.status === 'active') || null)
      : activeGoal;
    set({ goals: visibleGoals, activeGoal: newActive });
    // Sync to localStorage and cloud
    storage.updateGoal(goalId, { status: 'abandoned' });
    cloudSync(() => api.updateGoal(goalId, { status: 'abandoned' }));
    get().refreshDashboard();
  },

  pauseGoal: (goalId) => {
    const now = new Date().toISOString();
    const updatedGoals = get().goals.map(g =>
      g.id === goalId ? { ...g, status: 'paused' as const, paused_at: now, updated_at: now } : g
    );
    const active = updatedGoals.find(g => g.status === 'active') || null;
    set({ goals: updatedGoals, activeGoal: active });
    storage.pauseGoal(goalId);
    get().addToast('Goal paused', 'info');
    get().refreshDashboard();
    cloudSync(() => api.pauseGoal(goalId));
  },

  resumeGoal: (goalId) => {
    const now = new Date().toISOString();
    // Pause any other active goal first, then resume target
    const updatedGoals = get().goals.map(g => {
      if (g.id === goalId) return { ...g, status: 'active' as const, paused_at: undefined, updated_at: now };
      if (g.status === 'active') {
        storage.pauseGoal(g.id);
        cloudSync(() => api.pauseGoal(g.id));
        return { ...g, status: 'paused' as const, paused_at: now, updated_at: now };
      }
      return g;
    });
    const active = updatedGoals.find(g => g.id === goalId) || null;
    set({ goals: updatedGoals, activeGoal: active });
    storage.resumeGoal(goalId);
    get().addToast('Goal resumed', 'success');
    get().refreshDashboard();
    cloudSync(() => api.resumeGoal(goalId));
  },

  switchToGoal: (goalId) => {
    const goal = get().goals.find(g => g.id === goalId);
    if (!goal) return;
    if (goal.status === 'paused') {
      get().resumeGoal(goalId);
    } else {
      set({ activeGoal: goal });
      get().refreshDashboard();
    }
  },

  updateGoalProgress: (goalId) => {
    // Race-safe increment: previous code did `read goal → compute
    // newCompleted = goal.sessions_completed + 1 → write` in three
    // separate ticks, so two concurrent completions (e.g., a daily-
    // task-linked goal getting both the activeGoal-path AND the
    // task-goal-path increment from completeTimerSession) could each
    // read N and both write N+1, losing one increment.
    //
    // Fix: capture the post-increment value INSIDE Zustand's
    // functional `set(state => ...)` so the entire compute happens
    // atomically against the latest store snapshot. The persistence
    // calls below pull the just-set value back out via `get()`.
    const now = new Date().toISOString();
    let updatedGoalSnapshot: Goal | null = null;
    let recalResult: ReturnType<typeof recalibrate> | null = null;
    let isNowComplete = false;
    let needsFeedback = false;
    let justCompletedMilestoneTitle: string | null = null;
    let estimateDelta: { prev: number; next: number } | null = null;

    set((state) => {
      const goal = state.goals.find(g => g.id === goalId);
      if (!goal) return state;

      const newCompleted = goal.sessions_completed + 1;
      const updatedGoal: Goal = { ...goal, sessions_completed: newCompleted };

      // Milestones
      const updatedMilestones = updatedGoal.milestones.map(m => {
        if (!m.completed && newCompleted >= m.session_target) {
          return { ...m, completed: true, completed_at: now };
        }
        return m;
      });
      updatedGoal.milestones = updatedMilestones;

      const justCompleted = updatedMilestones.find(
        m => m.session_target === newCompleted && m.completed_at,
      );
      if (justCompleted) justCompletedMilestoneTitle = justCompleted.title;

      // Goal-complete check
      if (newCompleted >= updatedGoal.estimated_sessions_current) {
        updatedGoal.status = 'completed';
        updatedGoal.completed_at = now;
      }
      updatedGoal.updated_at = now;

      // Recalibrate inside the transaction so the snapshot reflects
      // post-increment counts; downstream persistence reads from it.
      const r = recalibrate(updatedGoal);
      const prevEstimate = updatedGoal.estimated_sessions_current;
      const newEstimate = updatedGoal.sessions_completed + r.remaining_sessions;
      updatedGoal.estimated_sessions_current = newEstimate;

      if (Math.abs(newEstimate - prevEstimate) >= 2 && updatedGoal.sessions_completed >= 5) {
        estimateDelta = { prev: prevEstimate, next: newEstimate };
      }

      needsFeedback = shouldTriggerFeedback(updatedGoal);
      isNowComplete = updatedGoal.status === 'completed';
      updatedGoalSnapshot = updatedGoal;
      recalResult = r;

      return {
        ...state,
        activeGoal: updatedGoal,
        goals: state.goals.map(g => g.id === goalId ? updatedGoal : g),
        recalibrationResult: r,
        showFeedback: needsFeedback && !isNowComplete,
        feedbackGoalId: needsFeedback && !isNowComplete ? goalId : null,
        showCelebration: isNowComplete,
      };
    });

    if (!updatedGoalSnapshot || !recalResult) return;

    // Surface user-facing toasts AFTER the atomic state write so the
    // toast queue isn't stomped by a re-render mid-flight.
    if (justCompletedMilestoneTitle) {
      get().addToast(`Milestone reached: ${justCompletedMilestoneTitle}!`, 'success');
    }
    if (estimateDelta) {
      get().addToast(
        `Estimate adjusted: ${(estimateDelta as { prev: number; next: number }).prev} → ${(estimateDelta as { prev: number; next: number }).next} sessions`,
        'info',
      );
    }

    // Persist using the snapshot captured above. updatedGoalSnapshot is
    // typed as `Goal | null` for early-return safety; once we get here
    // it's guaranteed non-null (we returned above otherwise). Asserting
    // with the explicit local — TS narrows on the !== null check.
    const snap: Goal = updatedGoalSnapshot;
    storage.updateGoal(goalId, {
      sessions_completed: snap.sessions_completed,
      milestones: snap.milestones,
      status: snap.status,
      completed_at: snap.completed_at,
      estimated_sessions_current: snap.estimated_sessions_current,
      updated_at: now,
    });
    cloudSync(() => api.updateGoal(goalId, {
      sessions_completed: snap.sessions_completed,
      milestones: snap.milestones,
      status: snap.status,
      completed_at: snap.completed_at,
      estimated_sessions_current: snap.estimated_sessions_current,
      updated_at: now,
    }));

    get().refreshDashboard();
  },

  completeGoal: (goalId) => {
    const now = new Date().toISOString();
    // Update goal in store directly
    const updatedGoals = get().goals.map(g =>
      g.id === goalId
        ? { ...g, status: 'completed' as const, completed_at: now, updated_at: now }
        : g
    );
    set({
      goals: updatedGoals,
      currentView: 'dashboard',
    });
    // Sync to localStorage and cloud
    storage.updateGoal(goalId, {
      status: 'completed',
      completed_at: now,
      updated_at: now,
    });
    cloudSync(() => api.updateGoal(goalId, {
      status: 'completed',
      completed_at: now,
      updated_at: now,
    }));
  },

  // Quick pomodoro — works without auth. Creates a minimal guest state
  // so FocusMode can render. After completion, shows signup prompt.
  startQuickPomodoro: () => {
    const focusDuration = 25 * 60;
    // Create a minimal guest user + placeholder goal so the existing
    // timer and focus mode machinery work without code changes.
    const guestUser = get().user || {
      id: '__guest__',
      email: null,
      name: null,
      is_admin: false,
      created_at: new Date().toISOString(),
      settings: { focus_duration: focusDuration, break_duration: 5 * 60, sound_enabled: true, theme: 'dark' },
    };
    const quickGoal = get().activeGoal || {
      id: '__quick__',
      user_id: '__guest__',
      title: 'Quick Focus Session',
      description: '',
      status: 'active' as const,
      sessions_completed: 0,
      estimated_sessions_initial: 1,
      estimated_sessions_current: 1,
      recommended_sessions_per_day: 1,
      confidence_score: 1,
      milestones: [],
      created_at: new Date().toISOString(),
    };

    if (guestUser.settings?.sound_enabled !== false) {
      playSound('session_start');
    }

    // Stash a local session id (no cloud sync for guest)
    const sessionId = crypto.randomUUID();

    set({
      user: guestUser as AppState['user'],
      activeGoal: quickGoal as AppState['activeGoal'],
      timerState: 'running',
      timeRemaining: focusDuration,
      currentSessionId: sessionId,
      isBreak: false,
      currentView: 'focus',
      quickPomodoroComplete: false,
    });
  },

  dismissQuickPomodoroPrompt: () => set({ quickPomodoroComplete: false }),

  startTimer: () => {
    const { activeGoal, user, dashboardMode, timerState } = get();
    if (!user) return;
    // In long-term mode, require an active goal
    if (dashboardMode === 'longterm' && !activeGoal) return;

    // Double-fire guard. startTimer is reachable from a button click,
    // a Cmd+K command, the FirstSessionRitual launch, the keyboard
    // shortcut, and the focus mode hotkey. Without this guard a near-
    // simultaneous double-trigger creates two session rows (local +
    // cloud) AND double-counts the first-session funnel event AND
    // double-prompts for push permission. Refusing to start when the
    // timer isn't actually idle is the right move — the existing
    // session keeps running and the second call is a clean no-op.
    if (timerState !== 'idle') return;

    const focusDuration = user.settings?.focus_duration || 25 * 60;

    // Funnel: detect first-ever session BEFORE the insert. We count
    // existing sessions in localStorage; cloud sync replays this count
    // on next init, so a returning user who's already completed sessions
    // doesn't incorrectly trip first_pomodoro_started again.
    const isFirstSession = storage.getCompletedSessions('').length === 0;

    // Create a session (use activeGoal if available, or a placeholder for daily grind)
    const goalId = activeGoal?.id || '__daily__';
    // Capture start_time ONCE so the local row and the cloud row share
    // the exact same timestamp. The previous code created the local
    // row with `new Date()` then called `api.createSession` with a
    // SECOND `new Date()` — a few-ms drift made the two rows look
    // like distinct sessions in joined queries.
    const startTime = new Date().toISOString();
    const session = storage.createSession({
      user_id: user.id,
      goal_id: goalId,
      start_time: startTime,
      duration: 0,
      status: 'active',
    });

    if (isFirstSession) {
      void track({
        distinctId: user.id,
        event: 'first_pomodoro_started',
        properties: { mode: dashboardMode },
      });
      // First-session is also a great moment to ask for notification
      // permission. Permission UX research: prompts during a high-
      // value action (here: starting a real focus session) get
      // accepted ~3-5× more often than load-time prompts.
      //
      // Two paths converge here:
      //   - If VAPID keys ARE configured server-side, ensureSubscribed
      //     prompts AND registers a Web Push subscription — gets us
      //     OS-level notifications even with the tab closed.
      //   - If VAPID isn't configured (e.g., first-time deploy
      //     without keys), ensureSubscribed silently no-ops; we still
      //     request Notification permission directly so the
      //     in-page sendNotification() path works on session-end.
      // Either way the user only ever sees ONE permission prompt.
      if (typeof window !== 'undefined') {
        void import('@/lib/push-client').then(async ({ ensureSubscribed }) => {
          const subscribed = await ensureSubscribed();
          if (!subscribed && typeof Notification !== 'undefined' && Notification.permission === 'default') {
            try { await Notification.requestPermission(); } catch { /* ignore */ }
          }
        });
      }
    }

    storage.saveTimerState({
      goalId,
      remaining: focusDuration,
      isRunning: true,
      sessionId: session.id,
    });

    // Write-through: create session + timer state in Supabase. Reuse
    // the locally-captured startTime so the cloud row matches the
    // local row exactly (no millisecond drift).
    cloudSync(async () => {
      await api.createSession({
        user_id: user.id,
        goal_id: goalId,
        start_time: startTime,
        duration: 0,
        status: 'active',
      });
      await api.saveTimerState({ goalId, remaining: focusDuration, isRunning: true, sessionId: session.id });
    });

    // Audible feedback on the start gesture. Inside the user click handler
    // here, the AudioContext can be created/resumed in-gesture, so this is
    // the most reliable place to make sound work. Gated on the user's
    // sound_enabled setting (default on).
    if (user?.settings?.sound_enabled !== false) {
      playSound('session_start');
    }

    set({
      timerState: 'running',
      timeRemaining: focusDuration,
      currentSessionId: session.id,
      isBreak: false,
      currentView: 'focus',
    });
  },

  pauseTimer: () => {
    const { timeRemaining, activeGoal, currentSessionId, user, timerState } = get();
    // Guard: pause only makes sense from 'running'. Without this guard
    // a stray hotkey or PiP-control double-tap from any other state
    // (idle / paused / break) would silently flip the store into
    // 'paused' with potentially-bogus timeRemaining, then the engine
    // would post PAUSE to a worker that's not actually counting.
    if (timerState !== 'running') return;
    if (activeGoal) {
      storage.saveTimerState({
        goalId: activeGoal.id,
        remaining: timeRemaining,
        isRunning: false,
        sessionId: currentSessionId || undefined,
      });
    }
    if (user?.settings?.sound_enabled !== false) {
      playSound('session_pause');
    }
    set({ timerState: 'paused' });
  },

  resumeTimer: () => {
    const { timeRemaining, activeGoal, currentSessionId, user, timerState } = get();
    // Guard: resume only makes sense from 'paused'. Same shape as
    // pauseTimer's guard above; protects against stray hotkey /
    // PiP-button double-fire from idle or break states.
    if (timerState !== 'paused') return;
    if (activeGoal) {
      storage.saveTimerState({
        goalId: activeGoal.id,
        remaining: timeRemaining,
        isRunning: true,
        sessionId: currentSessionId || undefined,
      });
    }
    if (user?.settings?.sound_enabled !== false) {
      playSound('session_start');
    }
    set({ timerState: 'running' });
  },

  // tickTimer: kept ONLY to satisfy the AppState type signature. The
  // TimerEngine owns all countdown mechanics now (worker + fallback
  // both compute remaining from Date.now() against a captured endsAt).
  // Any external call to tickTimer would corrupt the canonical
  // countdown by writing a stale `timeRemaining - 1`. This handler is
  // a true no-op so accidental references can't cause damage; remove
  // when we drop the type field entirely.
  tickTimer: () => {
    /* intentional no-op — see comment above */
  },

  completeTimerSession: () => {
    const { currentSessionId, activeGoal, user, dashboardMode, activeDailyTaskId, timerState, isBreak } = get();
    const focusDuration = user?.settings?.focus_duration || 25 * 60;
    const breakDuration = user?.settings?.break_duration || 5 * 60;

    // Double-fire guard. completeTimerSession is reachable from the
    // worker COMPLETE handler, the fallback timer's zero-tick branch,
    // any future "manually mark complete" UI, and (transitively) the
    // legacy tickTimer (now a no-op but external code may still
    // reference it). Without this guard, two near-simultaneous calls
    // double-count the daily-task pomodoro, double-call the cloud
    // session-complete endpoint, double-fire updateGoalProgress
    // (racy increment per the audit), and double-play the chime.
    //
    // The right shape of the guard: refuse to act if we're not in a
    // state where completion makes sense. The valid states are
    // 'running' (focus session about to end) and 'paused' (rare:
    // user paused near zero, then the worker COMPLETE arrived).
    // Critically NOT 'break' or 'idle' — both indicate the
    // completion already ran.
    if (timerState !== 'running' && timerState !== 'paused') return;
    // Also refuse if we're in a break — a break ending should hit the
    // engine's break-finished branch, not loop back through the
    // focus-completion path.
    if (isBreak) return;

    // Guest quick-pomodoro — skip all persistence, show signup prompt
    if (user?.id === '__guest__') {
      if (user?.settings?.sound_enabled !== false) {
        playSound('pomodoro_complete');
      }
      // Funnel: anonymous landing-page Quick Pomodoro completion. Use the
      // anon-cookie id so sign-up later joins this trace.
      void track({
        distinctId: 'guest', // overridden by getAnonymousId on browser side
        event: 'first_pomodoro_completed',
        properties: { mode: 'quick' },
      });
      set({
        timerState: 'idle',
        timeRemaining: focusDuration,
        isBreak: false,
        currentSessionId: null,
        quickPomodoroComplete: true,
      });
      return;
    }

    // Funnel: was this the user's first-ever real session? Detect BEFORE
    // we mark the in-progress session complete, so the count reflects
    // "completed before now" not "completed including this one."
    const wasFirstEver = !!user && storage.getCompletedSessions('').length === 0;

    if (currentSessionId) {
      storage.completeSession(currentSessionId, focusDuration);

      if (activeGoal) {
        get().updateGoalProgress(activeGoal.id);
      }

      // Write-through: complete session atomically in Supabase
      cloudSync(
        () => api.completeSession(currentSessionId, focusDuration),
        { url: '/api/sessions/complete', method: 'POST', body: { sessionId: currentSessionId, duration: focusDuration } },
      );

      // Funnel: first-ever completion is the Day-1 activation event.
      // We fire it AFTER persistence so a refreshed page reflects the
      // same state PostHog will see.
      if (wasFirstEver && user) {
        void track({
          distinctId: user.id,
          event: 'first_pomodoro_completed',
          properties: { mode: dashboardMode },
        });
      }
    }

    // If in daily grind mode with an active task, increment its pomodoro count
    if (dashboardMode === 'daily' && activeDailyTaskId) {
      // Read task from store and mutate in memory
      const taskIndex = get().dailyTasks.findIndex(t => t.id === activeDailyTaskId);
      if (taskIndex >= 0) {
        const task = get().dailyTasks[taskIndex];
        const newPomodorosDone = (task.pomodoros_done || 0) + 1;
        const isNowComplete = newPomodorosDone >= task.pomodoros_target;
        const updatedTask: DailyTask = {
          ...task,
          pomodoros_done: newPomodorosDone,
          completed: isNowComplete,
        };

        // Update store directly
        const updatedTasks = [...get().dailyTasks];
        updatedTasks[taskIndex] = updatedTask;
        set({ dailyTasks: updatedTasks });

        if (updatedTask.completed) {
          get().addToast(`"${updatedTask.title}" complete!`, 'success');
        }

        // Sync to localStorage and cloud
        storage.updateDailyTask(activeDailyTaskId, {
          pomodoros_done: updatedTask.pomodoros_done,
          completed: updatedTask.completed,
        });
        cloudSync(
          () => api.updateDailyTask(activeDailyTaskId, {
            pomodoros_done: updatedTask.pomodoros_done,
            completed: updatedTask.completed,
          }),
          { url: '/api/daily-tasks/update', method: 'POST', body: { taskId: activeDailyTaskId, pomodoros_done: updatedTask.pomodoros_done, completed: updatedTask.completed } },
        );
      }

      // If this daily task is linked to a long-term goal, increment that goal's progress too
      if (taskIndex >= 0) {
        const completedTask = get().dailyTasks.find(t => t.id === activeDailyTaskId);
        if (completedTask?.goal_id && completedTask.goal_id !== activeGoal?.id) {
          get().updateGoalProgress(completedTask.goal_id);
        }
      }
    }

    // Play pomodoro complete sound
    if (user?.settings?.sound_enabled !== false) {
      playSound('pomodoro_complete');
    }

    // Send notification
    get().sendNotification('Session complete!', 'Great work. Take a break.');

    // Fire AI session debrief in the background (non-blocking)
    if (activeGoal) {
      const dailyTask = activeDailyTaskId
        ? get().dailyTasks.find(t => t.id === activeDailyTaskId)
        : undefined;
      // In daily mode, pass per-task pomodoro counts instead of long-term
      // goal sessions (which can be 100+ and confuse the AI debrief).
      const sessionNum = dashboardMode === 'daily' && dailyTask
        ? (dailyTask.pomodoros_done || 0)
        : activeGoal.sessions_completed;
      const sessionTotal = dashboardMode === 'daily' && dailyTask
        ? dailyTask.pomodoros_target
        : activeGoal.estimated_sessions_current;
      get().requestSessionDebrief(
        sessionNum,
        sessionTotal,
        dailyTask?.title,
      );
    }

    // Transition to break
    set({
      timerState: 'break',
      timeRemaining: breakDuration,
      isBreak: true,
      currentSessionId: null,
      showSessionNotes: dashboardMode !== 'daily', // Skip notes prompt in daily grind
    });

    // Auto-start break timer after a moment.
    //
    // The 500ms delay lets the engine see the 'break' transition first
    // (it posts START to the worker), then we flip to 'running' so the
    // user-facing label says "Focus" instead of "Break starting...".
    //
    // Race protection: capture the breakDuration we just transitioned
    // INTO. If the user hits Skip Break or Reset within the 500ms
    // window, the break state will have changed (timerState !== 'break'
    // OR timeRemaining !== breakDuration). Re-checking BOTH is stricter
    // than the original guard which only checked isBreak + timerState
    // — that combo was vulnerable to a quick break-skip + start-new
    // sequence landing inside the window.
    const expectedBreakRemaining = breakDuration;
    setTimeout(() => {
      const state = get();
      if (
        state.isBreak &&
        state.timerState === 'break' &&
        state.timeRemaining === expectedBreakRemaining
      ) {
        set({ timerState: 'running' });
      }
    }, 500);

    storage.clearTimerState();
  },

  skipBreak: () => {
    const { user } = get();
    const focusDuration = user?.settings?.focus_duration || 25 * 60;
    set({
      timerState: 'idle',
      timeRemaining: focusDuration,
      isBreak: false,
    });
    storage.clearTimerState();
  },

  resetTimer: () => {
    const { currentSessionId, user } = get();
    const focusDuration = user?.settings?.focus_duration || 25 * 60;
    if (currentSessionId) {
      storage.discardSession(currentSessionId);
      cloudSync(() => api.discardSession(currentSessionId));
    }
    if (user?.settings?.sound_enabled !== false) {
      playSound('session_pause');
    }
    set({
      timerState: 'idle',
      timeRemaining: focusDuration,
      currentSessionId: null,
      isBreak: false,
    });
    storage.clearTimerState();
    cloudSync(() => api.clearTimerState());
  },

  submitFeedback: (bias) => {
    const { feedbackGoalId } = get();
    if (!feedbackGoalId) return;

    // Read goal from store only (source of truth)
    const goal = get().goals.find(g => g.id === feedbackGoalId);
    if (!goal) return;

    // Add feedback and recalibrate in memory — same const-binding, mutable-object
    // pattern as completeSession above.
    const updatedGoal = { ...goal };
    const now = new Date().toISOString();
    const newFeedbackEntry: FeedbackEntry = {
      timestamp: now,
      bias,
      sessions_at_time: updatedGoal.sessions_completed,
    };
    const newFeedbackLog = [...(updatedGoal.feedback_bias_log || []), newFeedbackEntry];
    updatedGoal.feedback_bias_log = newFeedbackLog;
    updatedGoal.updated_at = now;

    const result = recalibrate(updatedGoal);
    const prevEstimate = updatedGoal.estimated_sessions_current;
    const newEstimate = updatedGoal.sessions_completed + result.remaining_sessions;
    updatedGoal.estimated_sessions_current = newEstimate;

    // Update store directly
    const updatedGoals = get().goals.map(g => g.id === feedbackGoalId ? updatedGoal : g);
    set({
      goals: updatedGoals,
      activeGoal: updatedGoal,
      recalibrationResult: result,
      showFeedback: false,
      feedbackGoalId: null,
    });

    if (prevEstimate !== newEstimate) {
      get().addToast(`Estimate updated: ${prevEstimate} → ${newEstimate} sessions`, 'success');
    } else {
      get().addToast('Feedback recorded. Estimate unchanged.', 'info');
    }

    // Sync to localStorage and cloud
    storage.addFeedback(feedbackGoalId, bias);
    storage.updateGoal(feedbackGoalId, {
      feedback_bias_log: newFeedbackLog,
      estimated_sessions_current: newEstimate,
      updated_at: now,
    });
    cloudSync(() => api.addFeedback(feedbackGoalId, bias));
    cloudSync(() => api.updateGoal(feedbackGoalId, {
      feedback_bias_log: newFeedbackLog,
      estimated_sessions_current: newEstimate,
      updated_at: now,
    }));

    get().refreshDashboard();
  },

  dismissFeedback: () => {
    set({ showFeedback: false, feedbackGoalId: null });
  },

  submitSessionNotes: async (notes) => {
    // Find the most recent completed session and add notes
    const { activeGoal } = get();
    if (!activeGoal) return;
    // Try cloud first, fall back to localStorage
    let sessions: Session[] = [];
    try { sessions = await api.getCompletedSessions(activeGoal.id); } catch { sessions = storage.getCompletedSessions(activeGoal.id); }
    const latest = sessions[sessions.length - 1];
    if (latest) {
      storage.updateSession(latest.id, { notes });
      cloudSync(() => api.updateSession(latest.id, { notes }));
    }
    set({ showSessionNotes: false });
  },

  dismissSessionNotes: () => {
    set({ showSessionNotes: false });
  },

  addManualSession: (notes) => {
    const { activeGoal, user } = get();
    if (!activeGoal || !user) return;

    storage.createManualSession(user.id, activeGoal.id, notes);
    cloudSync(() => api.createManualSession(user.id, activeGoal.id, notes));
    get().updateGoalProgress(activeGoal.id);
    get().addToast('Manual session logged', 'success');
    set({ showManualSession: false });
  },

  updateSettings: (settings) => {
    // Capture the prior settings BEFORE the optimistic write so we
    // can roll back if the cloud sync fails. The previous code
    // toast'd "Settings saved" and never recovered if Supabase
    // rejected — leaving local + cloud divergent and the timer
    // engine using the unsaved values.
    const priorUser = get().user;
    const updated = storage.updateSettings(settings);
    if (updated) {
      set({ user: updated });
      get().addToast('Settings saved', 'success');
      cloudSync(async () => {
        try {
          await api.updateSettings(settings);
        } catch (err) {
          // Roll back local + storage if cloud write fails.
          if (priorUser) {
            storage.setUser(priorUser);
            set({ user: priorUser });
            get().addToast('Settings could not save — reverted', 'error');
          }
          throw err;
        }
      });
    }
  },

  updateAnchorHabit: async (text) => {
    const cur = get().user;
    if (!cur) return;
    // Capture prior value BEFORE optimistic write so a cloud failure
    // can revert. Without this, the optimistic update + "Anchor
    // saved" toast lied if Supabase rejected.
    const priorAnchor = cur.anchor_habit_text ?? null;
    // Defensive cap — DB CHECK is 80 chars; trim + slice here so a
    // longer paste never round-trips an error to the user.
    const cleaned = text != null ? text.trim().slice(0, 80) : null;
    // Optimistic in-memory update first; UI feedback is instant.
    set({ user: { ...cur, anchor_habit_text: cleaned } });
    // Cloud sync via the profiles update path. Single-column update
    // doesn't justify a dedicated api.updateAnchorHabit helper.
    let cloudOk = true;
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const { error } = await supabase
          .from('profiles')
          .update({ anchor_habit_text: cleaned })
          .eq('id', authUser.id);
        if (error) cloudOk = false;
      }
    } catch (e) {
      console.error('[updateAnchorHabit] cloud sync failed:', e);
      cloudOk = false;
    }

    if (cloudOk) {
      get().addToast(cleaned ? 'Anchor saved' : 'Anchor removed', 'success');
    } else {
      // Revert local state and surface a real-toast error so the
      // user knows the save didn't land.
      const reverted = get().user;
      if (reverted) {
        set({ user: { ...reverted, anchor_habit_text: priorAnchor } });
      }
      get().addToast('Could not save anchor — try again', 'error');
    }
  },

  addToast: (message, type = 'info') => {
    const toast: Toast = { id: generateId(), message, type, duration: 3000 };
    // Cap to 8 most-recent. Without this, a tab backgrounded for a
    // long time + many toasts queued + the GC dropping setTimeout
    // callbacks (Chrome aggressively does this on mobile) can grow
    // the array unboundedly. The N=8 cap keeps the visible UI sane
    // and bounds memory.
    set(state => ({ toasts: [...state.toasts, toast].slice(-8) }));
    setTimeout(() => {
      get().removeToast(toast.id);
    }, toast.duration);
  },

  removeToast: (id) => {
    set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }));
  },

  // Daily Grind actions
  setDashboardMode: (mode) => {
    storage.setDashboardMode(mode);
    set({ dashboardMode: mode });
  },

  setDailyGrindLayout: (layout) => {
    storage.setDailyGrindLayout(layout);
    set({ dailyGrindLayout: layout });
  },

  addDailyTask: (title, pomodorosTarget = 1, repeating = false, tag, goalId) => {
    const todayKey = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();

    // Build task object in memory
    const newTask: DailyTask = {
      id: generateId(),
      title,
      date: todayKey,
      pomodoros_target: pomodorosTarget,
      pomodoros_done: 0,
      completed: false,
      repeating: repeating || false,
      tag: tag || undefined,
      goal_id: goalId || undefined,
      created_at: now,
      order: get().dailyTasks.length,
    };

    // Update store directly by appending to current dailyTasks
    set({
      dailyTasks: [...get().dailyTasks, newTask],
    });

    // Sync to localStorage and cloud. `goalId` is passed through so the
    // task-to-goal link persists for cloud users (previously dropped here).
    storage.createDailyTask(title, pomodorosTarget, repeating, tag, goalId);
    cloudSync(() => api.createDailyTask(title, pomodorosTarget, repeating, tag, goalId));
  },

  addDailyTaskForDate: (title, date, pomodorosTarget = 1, repeating = false, tag, goalId) => {
    const now = new Date().toISOString();

    // Compute the order from tasks that ALREADY exist for the target date,
    // not from the currently-viewed date's task count. The earlier code
    // used `get().dailyTasks.length` — fine when the user is adding to
    // today, broken when they use PlanTomorrow to seed a different date
    // (every new tomorrow-task collided on the same `order`). For dates
    // not in the in-memory store we fall back to the localStorage count,
    // which is the authoritative offline copy and a good-enough proxy for
    // cloud (race-tolerant: cloud-side sort_order can be re-derived later).
    const existingForDate = date === get().dailyViewDate
      ? get().dailyTasks
      : storage.getDailyTasksForDate(date);
    const nextOrder = existingForDate.length;

    // Build task object in memory
    const newTask: DailyTask = {
      id: generateId(),
      title,
      date,
      pomodoros_target: pomodorosTarget,
      pomodoros_done: 0,
      completed: false,
      repeating: repeating || false,
      tag: tag || undefined,
      goal_id: goalId || undefined,
      created_at: now,
      order: nextOrder,
    };

    // If the task is for the currently viewed date, append to store
    // Otherwise, sync to storage/cloud only
    if (date === get().dailyViewDate) {
      set({
        dailyTasks: [...get().dailyTasks, newTask],
      });
    }

    // Sync to localStorage and cloud. `goalId` is passed through so cloud
    // users keep the task→goal association (previously dropped here).
    storage.createDailyTaskForDate(title, date, pomodorosTarget, repeating, tag, goalId);
    cloudSync(() => api.createDailyTaskForDate(title, date, pomodorosTarget, repeating, tag, goalId));
  },

  toggleTaskComplete: (taskId) => {
    // Toggle task directly in store
    const taskIndex = get().dailyTasks.findIndex(t => t.id === taskId);
    if (taskIndex < 0) return;

    const task = get().dailyTasks[taskIndex];
    const updatedTask: DailyTask = {
      ...task,
      completed: !task.completed,
    };

    const updatedTasks = [...get().dailyTasks];
    updatedTasks[taskIndex] = updatedTask;
    set({ dailyTasks: updatedTasks });

    if (updatedTask.completed) {
      get().addToast(`"${updatedTask.title}" done!`, 'success');
    }

    // Sync to localStorage and cloud
    storage.toggleDailyTaskComplete(taskId);
    cloudSync(() => api.toggleDailyTaskComplete(taskId));
  },

  deleteDailyTask: (taskId) => {
    // Filter directly from Zustand state (not localStorage) to avoid
    // the bug where cloud-loaded tasks aren't in localStorage
    const newTasks = get().dailyTasks.filter(t => t.id !== taskId);
    set({
      dailyTasks: newTasks,
      activeDailyTaskId: get().activeDailyTaskId === taskId ? null : get().activeDailyTaskId,
    });
    // Also remove from localStorage cache
    storage.deleteDailyTask(taskId);
    cloudSync(() => api.deleteDailyTask(taskId));
  },

  reorderDailyTasks: (date, orderedIds) => {
    // Build a sort_order map from the new ordering, then re-sort the
    // store's dailyTasks so the UI reflects the change immediately.
    // Tasks for OTHER dates (anything not in orderedIds) stay where
    // they are — this lets the day-nav re-renders not stomp on a
    // reorder the user just did for today.
    const orderMap = new Map<string, number>();
    orderedIds.forEach((id, idx) => orderMap.set(id, idx));

    const updated = get().dailyTasks.map((t) => {
      const newOrder = orderMap.get(t.id);
      if (newOrder == null || t.date !== date) return t;
      return { ...t, order: newOrder };
    });
    // Stable in-memory sort by date then order so the list renders
    // consistently. Other consumers (DailyGrind filter-by-date) keep
    // their existing slice patterns.
    updated.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.order - b.order;
    });

    set({ dailyTasks: updated });

    // Persist locally — same offline-first pattern as other actions.
    storage.reorderDailyTasks(date, orderedIds);

    // Cloud sync: one updateDailyTask call per moved task. Cheap (sub-
    // 10 tasks per reorder usually); a future micro-optimisation could
    // batch into a single endpoint, but the reorder action is rare
    // enough that it's not worth the new endpoint until usage data
    // says otherwise.
    cloudSync(async () => {
      await Promise.all(
        orderedIds.map((id, idx) => api.updateDailyTask(id, { order: idx })),
      );
    });
  },

  setActiveDailyTask: (taskId) => {
    set({ activeDailyTaskId: taskId });
  },

  completeDailyPomodoro: () => {
    const { activeDailyTaskId, user } = get();
    if (!activeDailyTaskId) return;

    // Increment pomodoro count directly in store
    const taskIndex = get().dailyTasks.findIndex(t => t.id === activeDailyTaskId);
    if (taskIndex < 0) return;

    const task = get().dailyTasks[taskIndex];
    const newPomodorosDone = (task.pomodoros_done || 0) + 1;
    const isNowComplete = newPomodorosDone >= task.pomodoros_target;

    const updatedTask: DailyTask = {
      ...task,
      pomodoros_done: newPomodorosDone,
      completed: isNowComplete,
    };

    const updatedTasks = [...get().dailyTasks];
    updatedTasks[taskIndex] = updatedTask;
    set({ dailyTasks: updatedTasks });

    if (isNowComplete) {
      get().addToast(`"${updatedTask.title}" complete!`, 'success');
    }

    // Sync to localStorage and cloud
    storage.updateDailyTask(activeDailyTaskId, {
      pomodoros_done: newPomodorosDone,
      completed: isNowComplete,
    });
    cloudSync(() => api.incrementTaskPomodoro(activeDailyTaskId));

    // Play pomodoro complete sound
    if (user?.settings?.sound_enabled !== false) {
      playSound('pomodoro_complete');
    }

    // Send notification
    get().sendNotification('Pomodoro complete!', 'Great work. Take a break.');
  },

  setDailyViewDate: async (date) => {
    set({ dailyViewDate: date });
    // Try cloud first, fall back to localStorage
    try {
      const tasks = await api.ensureRepeatingTasksForDate(date);
      set({ dailyTasks: tasks });
    } catch {
      const tasks = storage.ensureRepeatingTasksForDate(date);
      set({ dailyTasks: tasks });
    }
  },

  refreshDailyTasks: async () => {
    const { dailyViewDate } = get();
    try {
      const tasks = await api.getDailyTasksForDate(dailyViewDate);
      set({ dailyTasks: tasks });
    } catch {
      set({ dailyTasks: storage.getDailyTasksForDate(dailyViewDate) });
    }
  },

  removeRepeatingTemplate: (templateId) => {
    // Filter directly from store
    const updatedTemplates = get().repeatingTemplates.filter(t => t.id !== templateId);
    set({ repeatingTemplates: updatedTemplates });

    // Sync to localStorage and cloud
    storage.removeRepeatingTemplate(templateId);
    cloudSync(() => api.removeRepeatingTemplate(templateId));
  },

  updateDailyTaskDetails: (taskId, updates) => {
    // Update task directly in store
    const taskIndex = get().dailyTasks.findIndex(t => t.id === taskId);
    if (taskIndex < 0) return;

    const task = get().dailyTasks[taskIndex];
    const updatedTask: DailyTask = {
      ...task,
      ...updates,
    };

    const updatedTasks = [...get().dailyTasks];
    updatedTasks[taskIndex] = updatedTask;
    set({ dailyTasks: updatedTasks });

    // Sync to localStorage and cloud
    storage.updateDailyTask(taskId, updates);
    cloudSync(() => api.updateDailyTask(taskId, updates));
  },

  // ─── Journal ─────────────────────────────────────────────────────

  setJournalModalDate: (date) => {
    set({ journalModalDate: date });
  },

  saveJournalEntry: (date, content, mood) => {
    // Write to localStorage first — it returns the canonical row (with id +
    // timestamps) that we mirror into Zustand. This keeps the in-memory list
    // consistent whether or not cloud is reachable.
    const saved = storage.upsertJournalEntry(date, content, mood);

    // Optimistically merge into state: replace existing entry for this date,
    // or append if new. `journalEntries` is unordered in memory — consumers
    // that need chronological order sort at render time.
    const current = get().journalEntries;
    const idx = current.findIndex(e => e.date === date);
    const next = idx >= 0
      ? current.map((e, i) => (i === idx ? saved : e))
      : [...current, saved];
    set({ journalEntries: next });

    // Fire-and-forget cloud upsert. The server re-generates its own id +
    // timestamps via the UNIQUE(user_id, date) constraint and the
    // touch_updated_at trigger; we don't reconcile them back into state
    // because the local copy is already canonical for the UI's purposes.
    cloudSync(() => api.upsertJournalEntry(date, content, mood));
  },

  deleteJournalEntry: (date) => {
    // Optimistic removal from state so the indicator dot disappears
    // immediately. Both storage and cloud calls are idempotent — missing
    // rows are silent no-ops.
    const next = get().journalEntries.filter(e => e.date !== date);
    set({ journalEntries: next });

    storage.deleteJournalEntry(date);
    cloudSync(() => api.deleteJournalEntry(date));
  },

  requestJournalAIPrompt: async (date) => {
    // One-time guard. If the entry already has an ai_prompt we refuse
    // to overwrite it — the product rule is "one AI prompt per entry".
    // The UI disables the button too, but we defend the invariant here
    // for programmatic callers.
    const existing = get().journalEntries.find(e => e.date === date);
    if (existing?.ai_prompt) return null;

    // Gather context for a richer prompt. Everything is optional on the
    // server side so we can omit any field — but passing what we have
    // gets us prompts that reference the user's current situation.
    const { user, activeGoal, dashboardStats } = get();
    const payload = {
      date,
      mood: existing?.mood,
      goalTitle: activeGoal?.title,
      sessionsCompleted: activeGoal?.sessions_completed,
      sessionsTotal: activeGoal?.estimated_sessions_current,
      streakDays: dashboardStats?.current_streak,
      userName: user?.name,
    };

    // Curated fallback pool for when the API is unreachable (anonymous
    // users without a subscription, offline, etc.). These are
    // deliberately open-ended and don't assume any particular mood.
    const FALLBACK_PROMPTS = [
      'What is one small thing that went better than you expected today?',
      'If today had a headline, what would it say?',
      'What are you carrying into tomorrow — and what would you rather set down?',
      'Where did your attention actually go today, versus where you meant it to go?',
      'What is one thing you learned about yourself this week?',
      'If a friend had your exact day, what would you tell them?',
      'What tiny win is worth writing down so you remember it next month?',
      'What moment from today do you want to remember in a year?',
      'What is one thing you did today that your past self would be proud of?',
    ];

    let prompt = '';
    try {
      const res = await fetch('/api/coach/journal-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        prompt = (typeof data?.prompt === 'string' ? data.prompt : '').trim();
      }
    } catch {
      // Swallow network errors — fallback kicks in below.
    }

    if (!prompt) {
      prompt = FALLBACK_PROMPTS[Math.floor(Math.random() * FALLBACK_PROMPTS.length)];
    }

    // Persist locally. `setJournalAIPrompt` creates a shell entry if none
    // exists for the date, so we never lose the prompt just because the
    // user hadn't typed anything yet.
    const saved = storage.setJournalAIPrompt(date, prompt);

    // Merge into in-memory state: replace if this date already has a row,
    // otherwise append. Preserves the "unordered list" invariant.
    const current = get().journalEntries;
    const idx = current.findIndex(e => e.date === date);
    const next = idx >= 0
      ? current.map((e, i) => (i === idx ? saved : e))
      : [...current, saved];
    set({ journalEntries: next });

    // Best-effort cloud write. Uses a targeted upsert that only touches
    // the ai_prompt column so any in-flight content autosave is not
    // clobbered.
    cloudSync(() => api.setJournalAIPrompt(date, prompt));

    return prompt;
  },

  // ─── Shadow goals ────────────────────────────────────────────────

  setShowShadowGoals: (show) => set({ showShadowGoals: show }),
  setShowPlanTomorrow: (show) => set({ showPlanTomorrow: show }),

  addShadowGoal: (title, note = '') => {
    const trimmed = title.trim();
    if (!trimmed) return; // Ignore empty additions silently — UI guards too.

    // Local write returns the canonical row (id + timestamps); we mirror that
    // into Zustand so the new item shows up immediately, ahead of any cloud
    // round-trip. The sort ordering (newest-first) is enforced inside
    // storage.createShadowGoal.
    const created = storage.createShadowGoal(trimmed, note);
    set({ shadowGoals: [created, ...get().shadowGoals] });

    cloudSync(() => api.createShadowGoal(trimmed, note));
  },

  updateShadowGoal: (id, patch) => {
    const updated = storage.updateShadowGoal(id, patch);
    if (!updated) return; // Already gone — bail without touching state.

    set({
      shadowGoals: get().shadowGoals.map(g => (g.id === id ? updated : g)),
    });

    cloudSync(() => api.updateShadowGoal(id, patch));
  },

  removeShadowGoal: (id) => {
    set({ shadowGoals: get().shadowGoals.filter(g => g.id !== id) });
    storage.deleteShadowGoal(id);
    cloudSync(() => api.deleteShadowGoal(id));
  },

  promoteShadowGoal: (id) => {
    // Find the shadow first — if it's gone (e.g. deleted in another tab and
    // synced back) bail without mutating onboarding state.
    const shadow = get().shadowGoals.find(g => g.id === id);
    if (!shadow) return;

    // Park the id so completeOnboarding/createNewGoal can delete the shadow
    // row on success. We do NOT delete the shadow row up front — the user
    // might back out of onboarding, in which case the shelf entry should
    // still be there waiting for them.
    set({
      pendingShadowGoalId: id,
      // Prefill onboarding with the shadow's title + note. The motivation
      // note maps cleanly to the goal description field via OnboardingData.
      onboardingData: {
        goalTitle: shadow.title,
        motivationNote: shadow.note || undefined,
      },
      onboardingStep: 0,
      currentView: 'onboarding',
      // Close the shelf so the user isn't looking at it through the wizard.
      showShadowGoals: false,
    });
  },

  // ─── Subscription ────────────────────────────────────────────────

  fetchSubscriptionStatus: async () => {
    set({ subscriptionLoading: true });
    // Capture prior subscription so we can preserve it across
    // transient failures. The previous code overwrote with
    // {status:'none'} on ANY non-2xx, which meant a single transient
    // 401 (auth cookie hiccup, CORS preflight, revoked token mid-
    // request) would silently downgrade a paying Pro user to free
    // until the next refresh — Pro features would briefly disappear.
    const priorSub = get().subscription;
    try {
      const res = await fetch('/api/subscription/status');
      if (!res.ok) {
        if (res.status >= 500) {
          // Server tier outage — surface degraded banner. Keep prior
          // subscription so Pro features stay rendered until the
          // server confirms otherwise.
          get().setConnectionStatus('degraded', `subscription/status ${res.status}`);
          set({ subscriptionLoading: false });
          return;
        }
        if (res.status === 401 || res.status === 403) {
          // Authoritatively unauthenticated — only here do we
          // overwrite to 'none'. A real logout already cleared
          // local subscription via the logout action; this branch
          // catches the rarer case of a server-side session expiry.
          set({
            subscription: { status: 'none', plan_tier: 'starter' },
            subscriptionLoading: false,
          });
          return;
        }
        // Other 4xx — treat as transient; preserve prior state.
        set({ subscriptionLoading: false });
        return;
      }
      const data = await res.json();
      // Successful round-trip — clear any prior degradation.
      get().setConnectionStatus('ok');
      set({
        subscription: {
          status: data.status,
          plan_tier: data.plan_tier || 'starter',
          billing_cadence: data.billing_cadence === 'annual' ? 'annual' : 'monthly',
          razorpay_subscription_id: data.razorpay_subscription_id,
          plan_id: data.plan_id,
          trial_ends_at: data.trial_ends_at,
          current_period_end: data.current_period_end,
          cancelled_at: data.cancelled_at,
          created_at: data.created_at,
        },
        subscriptionLoading: false,
      });
    } catch (err) {
      // Network/CORS failure — almost always an outage at the edge.
      // Preserve prior subscription (don't downgrade on a transient).
      get().setConnectionStatus(
        'degraded',
        err instanceof Error ? err.message : 'subscription/status failed',
      );
      set({ subscription: priorSub, subscriptionLoading: false });
    }
  },

  startTrial: async (opts) => {
    try {
      const tier = opts?.tier || 'starter';
      const cadence: 'monthly' | 'annual' = opts?.cadence === 'annual' ? 'annual' : 'monthly';
      const isUpgrade = tier === 'pro' && get().isSubscriptionActive();

      const res = await fetch('/api/subscription/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier,
          cadence,
          couponCode: opts?.couponCode ?? null,
          couponId: opts?.couponId ?? null,
          offerId: opts?.offerId ?? null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        get().addToast(err.error || 'Could not start trial', 'error');
        return;
      }
      const data = await res.json();

      // Pull from pricing.ts so the Razorpay checkout description stays in
      // sync if the env-driven prices change. Earlier this was hardcoded
      // as '₹499/mo' / '₹999/mo' — out of sync with pricing.ts is a real
      // bait-and-switch risk on launch day. Annual variants use the
      // ₹X,XXX/year string from pricing so the checkout description
      // matches the modal's pricing copy exactly.
      const priceLabel = cadence === 'annual'
        ? (tier === 'pro' ? PRO_ANNUAL_PRICE_PER_YEAR : STARTER_ANNUAL_PRICE_PER_YEAR)
        : (tier === 'pro' ? PRO_PRICE_PER_MO : STARTER_PRICE_PER_MO);
      const description = isUpgrade
        ? `Upgrade to ${tier === 'pro' ? 'Pro' : 'Starter'} — ${priceLabel}`
        : `3-day free trial, then ${priceLabel}`;

      // Open Razorpay checkout — wait up to 5 s for the lazy-loaded
      // checkout.js to attach window.Razorpay. Without this, a fast clicker
      // who hits Subscribe before the script finishes loading sees nothing
      // happen (silent no-op) — the API call already created the Razorpay
      // subscription server-side, so they're "in trial" but with no UI cue.
      if (typeof window !== 'undefined') {
        const ready = await new Promise<boolean>((resolve) => {
          const check = () => Boolean((window as unknown as Record<string, unknown>).Razorpay);
          if (check()) return resolve(true);
          let elapsed = 0;
          const tickMs = 200;
          const id = setInterval(() => {
            if (check()) {
              clearInterval(id);
              resolve(true);
            } else if ((elapsed += tickMs) >= 5000) {
              clearInterval(id);
              resolve(false);
            }
          }, tickMs);
        });
        if (!ready) {
          get().addToast(
            'Checkout is taking a while to load. Refresh and try again.',
            'error',
          );
          return;
        }
        const RazorpayConstructor = (window as unknown as Record<string, new (opts: Record<string, unknown>) => { open: () => void }>).Razorpay;
        const rzp = new RazorpayConstructor({
          key: data.key_id,
          subscription_id: data.subscription_id,
          name: 'EffortOS',
          description,
          handler: async (response: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => {
            // Verify payment
            const verifyRes = await fetch('/api/subscription/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...response, plan_tier: tier }),
            });
            if (verifyRes.ok) {
              set({
                subscription: {
                  status: isUpgrade ? 'active' : 'trialing',
                  plan_tier: tier,
                  billing_cadence: cadence,
                  razorpay_subscription_id: data.subscription_id,
                  trial_ends_at: data.trial_ends_at,
                },
                showPaywall: false,
              });
              const msg = isUpgrade
                ? 'Upgraded to Pro! Your AI coach is now active.'
                : 'Trial started! You have 3 days of full access.';
              get().addToast(msg, 'success');
            } else {
              get().addToast('Payment verification failed. Please try again.', 'error');
            }
          },
          theme: { color: tier === 'pro' ? '#8b5cf6' : '#06b6d4' },
        });
        rzp.open();
      }
    } catch {
      get().addToast('Could not connect to payment system', 'error');
    }
  },

  cancelSubscription: async () => {
    try {
      const res = await fetch('/api/subscription/cancel', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        get().addToast(err.error || 'Could not cancel', 'error');
        return;
      }
      const data = await res.json();
      set({
        subscription: {
          ...get().subscription,
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
        },
      });
      get().addToast(data.message || 'Subscription cancelled', 'info');
    } catch {
      get().addToast('Could not cancel subscription', 'error');
    }
  },

  pauseSubscription: async () => {
    try {
      const res = await fetch('/api/subscription/pause', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        get().addToast(data.error || 'Could not pause', 'error');
        return;
      }
      set({
        subscription: {
          ...get().subscription,
          status: 'paused',
        },
      });
      get().addToast(data.message || 'Subscription paused', 'info');
    } catch {
      get().addToast('Could not pause subscription', 'error');
    }
  },

  resumeSubscription: async () => {
    try {
      const res = await fetch('/api/subscription/resume', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        get().addToast(data.error || 'Could not resume', 'error');
        return;
      }
      set({
        subscription: {
          ...get().subscription,
          status: 'active',
        },
      });
      get().addToast(data.message || 'Welcome back', 'success');
    } catch {
      get().addToast('Could not resume subscription', 'error');
    }
  },

  setFocusBackground: ({ id, dim }) => {
    const u = get().user;
    if (!u) return;
    // Build the patch — only fields the caller specified, so a slider-
    // only update doesn't accidentally clobber a just-picked id.
    const patch: { focus_background_id?: string | null; focus_background_dim?: number } = {};
    if (id !== undefined) patch.focus_background_id = id;
    if (typeof dim === 'number') {
      patch.focus_background_dim = Math.max(0, Math.min(100, Math.floor(dim)));
    }
    if (Object.keys(patch).length === 0) return;

    // Optimistic local update so the picker tile flips immediately.
    set({ user: { ...u, ...patch } });

    // Persist to profiles via the same cloudSync pattern used elsewhere.
    cloudSync(async () => {
      const supabase = createClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;
      await supabase
        .from('profiles')
        .update(patch)
        .eq('id', authUser.id);
    });
  },

  freezeStreak: async (date = 'today') => {
    try {
      const res = await fetch('/api/streaks/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        get().addToast(data.error || 'Could not freeze that day', 'error');
        return;
      }
      // Optimistically reflect the new token count so the CTA disables
      // immediately without waiting for a re-fetch. The endpoint also
      // returns the authoritative remaining count, so we trust it.
      const currentUser = get().user;
      if (currentUser) {
        set({
          user: {
            ...currentUser,
            freeze_tokens_remaining: typeof data.remaining_tokens === 'number'
              ? data.remaining_tokens
              : currentUser.freeze_tokens_remaining,
          },
        });
      }
      const dayLabel = date === 'today' ? 'today' : 'yesterday';
      get().addToast(`Streak protected for ${dayLabel} 🛡️`, 'success');
    } catch {
      get().addToast('Could not freeze that day', 'error');
    }
  },

  setShowPaywall: (show) => set({ showPaywall: show }),

  isSubscriptionActive: () => {
    const { subscription } = get();
    return subscription.status === 'trialing' || subscription.status === 'active';
  },

  isProTier: () => {
    const { subscription } = get();
    return (subscription.status === 'trialing' || subscription.status === 'active') && subscription.plan_tier === 'pro';
  },

  // ─── Reports ──────────────────────────────────────────────────────

  setReportGoalId: (goalId) => set({ reportGoalId: goalId }),
  openGoalReport: (goalId) => {
    set({ reportGoalId: goalId, dashboardMode: 'reports' as DashboardMode });
  },

  // ─── AI Coach Actions ───────────────────────────────────────────

  requestPlanMyDay: async (intake) => {
    const { user, goals, dailyTasks, dailyViewDate } = get();
    if (!user) return;
    set({ coachPlanLoading: true, coachPlan: null });
    try {
      // Try cloud first, fall back to localStorage for session history
      let sessions: Session[] = [];
      try { sessions = await api.getSessions(); } catch { sessions = storage.getSessions(); }
      const context = buildCoachContext(user, goals, sessions, dailyTasks);
      const taskSummaries = dailyTasks.map(t => ({
        title: t.title,
        tag: t.tag || undefined,
        pomodorosTarget: t.pomodoros_target,
        pomodorosDone: t.pomodoros_done,
        completed: t.completed,
        repeating: t.repeating || false,
      }));
      const plan = await fetchPlanMyDay({
        context,
        targetDate: dailyViewDate,
        existingTasks: taskSummaries,
        intake: intake || undefined,
      });
      set({ coachPlan: plan, coachPlanLoading: false });
    } catch (err) {
      console.error('Plan My Day failed:', err);
      set({ coachPlanLoading: false });
      get().addToast('AI Coach is unavailable right now. Try again later.', 'error');
    }
  },

  requestSessionDebrief: async (sessionNumber, totalForGoal, taskTitle, notes) => {
    const { user, goals, dailyTasks, activeGoal } = get();
    if (!user || !activeGoal) return;
    set({ coachDebriefLoading: true, coachDebrief: null });
    try {
      // Try cloud first, fall back to localStorage for session history
      let sessions: Session[] = [];
      try { sessions = await api.getSessions(); } catch { sessions = storage.getSessions(); }
      const context = buildCoachContext(user, goals, sessions, dailyTasks);
      const focusDuration = user.settings?.focus_duration || 25 * 60;
      const debrief = await fetchSessionDebrief({
        context,
        justCompleted: {
          goalTitle: activeGoal.title,
          taskTitle,
          duration: focusDuration,
          sessionNumber,
          totalForGoal,
          notes,
        },
      });
      set({ coachDebrief: debrief, coachDebriefLoading: false });
    } catch (err) {
      console.error('Session Debrief failed:', err);
      set({ coachDebriefLoading: false });
    }
  },

  requestWeeklyInsight: async (weekSessions, previousWeekCount) => {
    const { user, goals, dailyTasks } = get();
    if (!user) return;
    set({ coachWeeklyLoading: true, coachWeekly: null });
    try {
      // Try cloud first, fall back to localStorage for session history
      let sessions: Session[] = [];
      try { sessions = await api.getSessions(); } catch { sessions = storage.getSessions(); }
      const context = buildCoachContext(user, goals, sessions, dailyTasks);
      const weekSessionSummaries = weekSessions
        .filter(s => s.status === 'completed')
        .map(s => ({
          date: (s.end_time || s.start_time).split('T')[0],
          duration: s.duration || (user.settings?.focus_duration || 25 * 60),
          goalTitle: goals.find(g => g.id === s.goal_id)?.title,
          notes: s.notes || undefined,
        }));
      const weekTaskSummaries = dailyTasks.map(t => ({
        title: t.title,
        tag: t.tag || undefined,
        pomodorosTarget: t.pomodoros_target,
        pomodorosDone: t.pomodoros_done,
        completed: t.completed,
        repeating: t.repeating || false,
      }));
      const insight = await fetchWeeklyInsight({
        context,
        weekSessions: weekSessionSummaries,
        weekTasks: weekTaskSummaries,
        previousWeekSessions: previousWeekCount,
      });
      set({ coachWeekly: insight, coachWeeklyLoading: false });
    } catch (err) {
      console.error('Weekly Insight failed:', err);
      set({ coachWeeklyLoading: false });
      get().addToast('Weekly insights unavailable right now.', 'error');
    }
  },

  dismissCoachPlan: () => set({ coachPlan: null }),
  dismissCoachDebrief: () => set({ coachDebrief: null }),
  dismissCoachWeekly: () => set({ coachWeekly: null }),

  refreshDashboard: async () => {
    const { activeGoal } = get();
    if (!activeGoal) {
      set({ dashboardStats: null });
      return;
    }

    // Try cloud first, fall back to localStorage
    let dailySessions: DailySession[] = [];
    try { dailySessions = await api.getDailySessions(activeGoal.id); } catch { dailySessions = storage.getDailySessions(activeGoal.id); }
    const streaks = getStreaks(dailySessions);

    const sessionsRemaining = Math.max(0, activeGoal.estimated_sessions_current - activeGoal.sessions_completed);
    const totalHours = sessionsToHours(activeGoal.sessions_completed);
    const completionPct = activeGoal.estimated_sessions_current > 0
      ? Math.min(100, Math.round((activeGoal.sessions_completed / activeGoal.estimated_sessions_current) * 100))
      : 0;

    const daysActive = Math.max(1,
      (Date.now() - new Date(activeGoal.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    const dailyPace = activeGoal.sessions_completed / daysActive;
    const daysRemaining = dailyPace > 0 ? Math.ceil(sessionsRemaining / dailyPace) : activeGoal.estimated_days;
    const projectedDate = new Date();
    projectedDate.setDate(projectedDate.getDate() + daysRemaining);

    const expectedPace = activeGoal.recommended_sessions_per_day;
    let paceStatus: DashboardStats['pace_status'] = 'on_track';
    if (dailyPace > expectedPace * 1.2) paceStatus = 'ahead';
    else if (dailyPace < expectedPace * 0.6) paceStatus = 'behind';
    else if (dailyPace < expectedPace * 0.85) paceStatus = 'adjusting';

    const stats: DashboardStats = {
      completion_percentage: completionPct,
      sessions_done: activeGoal.sessions_completed,
      sessions_remaining: sessionsRemaining,
      total_hours: totalHours,
      projected_completion: projectedDate.toISOString(),
      current_streak: streaks.current,
      longest_streak: streaks.longest,
      pace_status: paceStatus,
      daily_sessions: dailySessions,
    };

    set({ dashboardStats: stats });
  },

  setView: (view) => set({ currentView: view }),
  setShowCelebration: (show) => set({ showCelebration: show }),
  setShowGoalHistory: (show) => set({ showGoalHistory: show }),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowManualSession: (show) => set({ showManualSession: show }),
  setShowEditGoal: (show) => set({ showEditGoal: show }),
  setShowExitConfirm: (show) => set({ showExitConfirm: show }),
  setShowAIPlanWizard: (show) => set({ showAIPlanWizard: show }),
  setRemoteTimerInfo: (info) => set({ remoteTimerInfo: info }),

  requestNotificationPermission: () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      Notification.requestPermission();
    }
  },

  sendNotification: (title, body) => {
    const { user } = get();
    if (!user?.settings?.notifications_enabled) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  },
}));
