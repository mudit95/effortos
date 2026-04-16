'use client';

import { create } from 'zustand';
import {
  User, Goal, Session, TimerState, OnboardingData,
  DashboardStats, RecalibrationResult, Toast, UserSettings, DEFAULT_SETTINGS,
  DashboardMode, DailyTask, DailySession, RepeatingTaskTemplate, TaskTagId,
  SubscriptionStatus, SubscriptionInfo, FeedbackEntry,
} from '@/types';
import * as storage from '@/lib/storage';
import { estimateEffort, recalibrate, shouldTriggerFeedback, calculateTimeBias } from '@/lib/estimation';
import { getStreaks, sessionsToHours, generateId } from '@/lib/utils';
import { playSound } from '@/lib/sounds';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { resetProvider as resetDataLayerProvider, migrateLocalDataToCloud } from '@/lib/dataLayer';
import * as api from '@/lib/api';
import {
  buildCoachContext,
  fetchPlanMyDay,
  fetchSessionDebrief,
  fetchWeeklyInsight,
  type PlanMyDayResponse,
  type SessionDebriefResponse,
  type WeeklyInsightResponse,
} from '@/lib/coachClient';

/** Fire-and-forget Supabase write. Logs errors but never blocks. */
function cloudSync(fn: () => Promise<unknown>): void {
  if (!isSupabaseConfigured()) return;
  fn().catch(err => console.warn('Cloud sync failed:', err));
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

  addToast: (message: string, type?: Toast['type']) => void;
  removeToast: (id: string) => void;

  // Daily Grind actions
  setDashboardMode: (mode: DashboardMode) => void;
  addDailyTask: (title: string, pomodorosTarget?: number, repeating?: boolean, tag?: TaskTagId, goalId?: string) => void;
  addDailyTaskForDate: (title: string, date: string, pomodorosTarget?: number, repeating?: boolean, tag?: TaskTagId, goalId?: string) => void;
  toggleTaskComplete: (taskId: string) => void;
  deleteDailyTask: (taskId: string) => void;
  setActiveDailyTask: (taskId: string | null) => void;
  completeDailyPomodoro: () => void;
  setDailyViewDate: (date: string) => void;
  refreshDailyTasks: () => void;
  removeRepeatingTemplate: (templateId: string) => void;
  updateDailyTaskDetails: (taskId: string, updates: Partial<DailyTask>) => void;

  // Subscription
  fetchSubscriptionStatus: () => void;
  startTrial: (opts?: { couponCode?: string; couponId?: string; offerId?: string }) => void;
  cancelSubscription: () => void;
  setShowPaywall: (show: boolean) => void;
  isSubscriptionActive: () => boolean;

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
  dashboardMode: 'longterm',
  dailyTasks: [],
  repeatingTemplates: [],
  activeDailyTaskId: null,
  dailyViewDate: new Date().toISOString().split('T')[0],
  subscription: { status: 'none' as SubscriptionStatus },
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

  initializeApp: async () => {
    // If user explicitly logged out (currentView === 'landing' and not loading), skip re-init
    const currentState = get();
    if (currentState.currentView === 'landing' && !currentState.isLoading && !currentState.isAuthenticated) {
      return;
    }

    let isCloud = false;

    try {
    // Check Supabase session first (only if configured)
    if (isSupabaseConfigured()) try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        isCloud = true;

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

          // ── Cloud path: load data from Supabase ──
          // Keep localStorage goals cached as an offline fallback — we only
          // overwrite it after a successful cloud fetch, never clear it
          // eagerly. Clearing eagerly caused a race on page refresh where a
          // transient auth hiccup would fall through to the localStorage path
          // with zero goals and incorrectly open the onboarding flow.
          let cachedGoals: Goal[] = [];
          try { cachedGoals = storage.getGoals(); } catch { /* ok */ }

          let cloudGoals: Goal[];
          try {
            cloudGoals = await api.getGoals();
          } catch {
            cloudGoals = cachedGoals; // Restore from cache if cloud fails
          }
          const cloudActiveGoal = cloudGoals.find(g => g.status === 'active') || null;
          const focusDuration = supaUser.settings?.focus_duration || 25 * 60;

          // Recover timer state from localStorage first (instant), fallback to cloud
          const timerSaved = storage.getTimerState();
          let timeRemaining = focusDuration;
          let timerState: TimerState = 'idle';
          let currentSessionId: string | null = null;

          if (timerSaved && timerSaved.isRunning && cloudActiveGoal) {
            const elapsed = Math.floor((Date.now() - timerSaved.savedAt) / 1000);
            const remaining = timerSaved.remaining - elapsed;
            if (remaining > 0) {
              timeRemaining = remaining;
              timerState = 'paused';
              currentSessionId = timerSaved.sessionId || null;
            }
          }

          // Load daily grind state
          const dashboardMode = storage.getDashboardMode();
          const todayKey = new Date().toISOString().split('T')[0];
          let dailyTasks: DailyTask[] = [];
          let repeatingTemplates: RepeatingTaskTemplate[] = [];
          try {
            dailyTasks = await api.getDailyTasksForDate(todayKey);
            repeatingTemplates = await api.getRepeatingTemplates();
          } catch {
            dailyTasks = storage.ensureRepeatingTasksForDate(todayKey);
            repeatingTemplates = storage.getRepeatingTemplates().filter(t => t.active);
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
            dailyTasks,
            repeatingTemplates,
            dailyViewDate: todayKey,
            // Priority: active goal → dashboard.
            // Otherwise, if user has ever completed onboarding OR has ANY goal
            // in their history (paused/completed), keep them on dashboard.
            // Only a brand-new user with no goals and no onboarding goes to onboarding.
            currentView:
              cloudActiveGoal
                ? 'dashboard'
                : (supaUser.onboarding_completed || cloudGoals.length > 0)
                  ? 'dashboard'
                  : 'onboarding',
          });

          if (cloudActiveGoal) get().refreshDashboard();
          // Fetch subscription status in background
          get().fetchSubscriptionStatus();
          return; // Done — skip localStorage path below
        }
      }
    } catch (err) {
      // Supabase unavailable — fall back to localStorage
      console.warn('Supabase session check failed, using localStorage:', err);
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
      // Not yet hydrated — wait briefly for auth listener to re-trigger.
      // Safety net: if still loading after 3 seconds, show landing page
      // so the user isn't stuck on a forever-spinner.
      setTimeout(() => {
        const s = get();
        if (s.isLoading && !s.isAuthenticated) {
          set({ isLoading: false, currentView: 'landing' });
        }
      }, 3000);
      return;
    }

    const user = storage.getUser();
    if (user) {
      const goals = storage.getGoals();
      const activeGoal = goals.find(g => g.status === 'active') || null;
      const focusDuration = user.settings?.focus_duration || 25 * 60;

      // Recover timer state
      const timerSaved = storage.getTimerState();
      let timeRemaining = focusDuration;
      let timerState: TimerState = 'idle';
      let currentSessionId: string | null = null;

      if (timerSaved && timerSaved.isRunning && activeGoal) {
        const elapsed = Math.floor((Date.now() - timerSaved.savedAt) / 1000);
        const remaining = timerSaved.remaining - elapsed;
        if (remaining > 0) {
          timeRemaining = remaining;
          timerState = 'paused';
          currentSessionId = timerSaved.sessionId || null;
        }
      }

      // Load daily grind state
      const dashboardMode = storage.getDashboardMode();
      const todayKey = new Date().toISOString().split('T')[0];
      const dailyTasks = storage.ensureRepeatingTasksForDate(todayKey);
      const repeatingTemplates = storage.getRepeatingTemplates().filter(t => t.active);

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
        dailyTasks,
        repeatingTemplates,
        dailyViewDate: todayKey,
        currentView: activeGoal ? 'dashboard' : (goals.length > 0 ? 'dashboard' : 'onboarding'),
      });

      if (activeGoal) get().refreshDashboard();
    } else {
      set({ isLoading: false, currentView: 'landing' });
    }
    } catch (fatalErr) {
      // Global safety net — if anything in init crashes, show landing page
      console.error('App initialization failed:', fatalErr);
      set({ isLoading: false, currentView: 'landing', user: null, isAuthenticated: false });
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
    try { storage.clearAllData(); } catch {}
    if (isSupabaseConfigured()) try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // Continue even if Supabase signOut fails
    }
  },

  setOnboardingStep: (step) => set({ onboardingStep: step }),

  updateOnboardingData: (data) => {
    set(state => ({
      onboardingData: { ...state.onboardingData, ...data },
    }));
  },

  completeOnboarding: () => {
    const { onboardingData, user } = get();
    if (!user || !onboardingData.goalTitle) return;

    let goal: Goal;
    try {
      goal = get().createNewGoal(onboardingData as OnboardingData);
    } catch {
      // Max goals reached — go back to dashboard
      set({ currentView: 'dashboard', onboardingStep: 0, onboardingData: {} });
      return;
    }
    storage.updateUser({ onboarding_completed: true });
    // Sync onboarding_completed flag to Supabase
    cloudSync(async () => {
      const supabase = createClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        await supabase.from('profiles').update({ onboarding_completed: true }).eq('id', authUser.id);
      }
    });

    set({
      user: { ...user, onboarding_completed: true },
      activeGoal: goal,
      currentView: 'dashboard',
      onboardingStep: 0,
      onboardingData: {},
    });

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
    cloudSync(() => api.createGoal(goalData));

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
    // Read from store only (source of truth)
    const goal = get().goals.find(g => g.id === goalId);
    if (!goal) return;

    const newCompleted = goal.sessions_completed + 1;
    const now = new Date().toISOString();

    // Apply updates in memory
    let updatedGoal = { ...goal, sessions_completed: newCompleted };

    // Check milestones
    const updatedMilestones = updatedGoal.milestones.map(m => {
      if (!m.completed && newCompleted >= m.session_target) {
        return { ...m, completed: true, completed_at: now };
      }
      return m;
    });
    updatedGoal.milestones = updatedMilestones;

    // Check milestone just completed for toast
    const justCompleted = updatedMilestones.find(
      m => m.session_target === newCompleted && m.completed_at
    );
    if (justCompleted) {
      get().addToast(`Milestone reached: ${justCompleted.title}!`, 'success');
    }

    // Check if goal is complete
    if (newCompleted >= updatedGoal.estimated_sessions_current) {
      updatedGoal.status = 'completed';
      updatedGoal.completed_at = now;
    }

    updatedGoal.updated_at = now;

    // Recalibrate on the updated goal
    const recalResult = recalibrate(updatedGoal);
    const prevEstimate = updatedGoal.estimated_sessions_current;
    const newEstimate = updatedGoal.sessions_completed + recalResult.remaining_sessions;
    updatedGoal.estimated_sessions_current = newEstimate;

    // Show recalibration toast if estimate changed meaningfully
    if (Math.abs(newEstimate - prevEstimate) >= 2 && updatedGoal.sessions_completed >= 5) {
      get().addToast(
        `Estimate adjusted: ${prevEstimate} → ${newEstimate} sessions`,
        'info'
      );
    }

    // Check if feedback should be triggered
    const needsFeedback = shouldTriggerFeedback(updatedGoal);
    const isNowComplete = updatedGoal.status === 'completed';

    // Update store directly
    const updatedGoals = get().goals.map(g => g.id === goalId ? updatedGoal : g);
    set({
      activeGoal: updatedGoal,
      goals: updatedGoals,
      recalibrationResult: recalResult,
      showFeedback: needsFeedback && !isNowComplete,
      feedbackGoalId: needsFeedback && !isNowComplete ? goalId : null,
      showCelebration: isNowComplete,
    });

    // Sync to localStorage and cloud
    storage.updateGoal(goalId, {
      sessions_completed: newCompleted,
      milestones: updatedMilestones,
      status: updatedGoal.status,
      completed_at: updatedGoal.completed_at,
      estimated_sessions_current: newEstimate,
      updated_at: now,
    });
    cloudSync(() => api.updateGoal(goalId, {
      sessions_completed: newCompleted,
      milestones: updatedMilestones,
      status: updatedGoal.status,
      completed_at: updatedGoal.completed_at,
      estimated_sessions_current: newEstimate,
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

  startTimer: () => {
    const { activeGoal, user, dashboardMode } = get();
    if (!user) return;
    // In long-term mode, require an active goal
    if (dashboardMode === 'longterm' && !activeGoal) return;

    const focusDuration = user.settings?.focus_duration || 25 * 60;

    // Create a session (use activeGoal if available, or a placeholder for daily grind)
    const goalId = activeGoal?.id || '__daily__';
    const session = storage.createSession({
      user_id: user.id,
      goal_id: goalId,
      start_time: new Date().toISOString(),
      duration: 0,
      status: 'active',
    });

    storage.saveTimerState({
      goalId,
      remaining: focusDuration,
      isRunning: true,
      sessionId: session.id,
    });

    // Write-through: create session + timer state in Supabase
    cloudSync(async () => {
      await api.createSession({
        user_id: user.id,
        goal_id: goalId,
        start_time: new Date().toISOString(),
        duration: 0,
        status: 'active',
      });
      await api.saveTimerState({ goalId, remaining: focusDuration, isRunning: true, sessionId: session.id });
    });

    set({
      timerState: 'running',
      timeRemaining: focusDuration,
      currentSessionId: session.id,
      isBreak: false,
      currentView: 'focus',
    });
  },

  pauseTimer: () => {
    const { timeRemaining, activeGoal, currentSessionId } = get();
    if (activeGoal) {
      storage.saveTimerState({
        goalId: activeGoal.id,
        remaining: timeRemaining,
        isRunning: false,
        sessionId: currentSessionId || undefined,
      });
    }
    set({ timerState: 'paused' });
  },

  resumeTimer: () => {
    const { timeRemaining, activeGoal, currentSessionId } = get();
    if (activeGoal) {
      storage.saveTimerState({
        goalId: activeGoal.id,
        remaining: timeRemaining,
        isRunning: true,
        sessionId: currentSessionId || undefined,
      });
    }
    set({ timerState: 'running' });
  },

  tickTimer: () => {
    const { timeRemaining, timerState, isBreak, user } = get();
    if (timerState !== 'running') return;

    if (timeRemaining <= 1) {
      if (isBreak) {
        const focusDuration = user?.settings?.focus_duration || 25 * 60;
        set({ timerState: 'idle', timeRemaining: focusDuration, isBreak: false });
        storage.clearTimerState();
        // Play break complete sound
        if (user?.settings?.sound_enabled !== false) {
          playSound('break_complete');
        }
        get().sendNotification('Break over!', 'Time to start your next focus session.');
      } else {
        get().completeTimerSession();
      }
      return;
    }

    set({ timeRemaining: timeRemaining - 1 });
  },

  completeTimerSession: () => {
    const { currentSessionId, activeGoal, user, dashboardMode, activeDailyTaskId, dailyViewDate } = get();
    const focusDuration = user?.settings?.focus_duration || 25 * 60;
    const breakDuration = user?.settings?.break_duration || 5 * 60;

    if (currentSessionId) {
      storage.completeSession(currentSessionId, focusDuration);

      if (activeGoal) {
        get().updateGoalProgress(activeGoal.id);
      }

      // Write-through: complete session atomically in Supabase
      cloudSync(() => api.completeSession(currentSessionId, focusDuration));
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
        cloudSync(() => api.updateDailyTask(activeDailyTaskId, {
          pomodoros_done: updatedTask.pomodoros_done,
          completed: updatedTask.completed,
        }));
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
      const taskTitle = activeDailyTaskId
        ? get().dailyTasks.find(t => t.id === activeDailyTaskId)?.title
        : undefined;
      get().requestSessionDebrief(
        activeGoal.sessions_completed,
        activeGoal.estimated_sessions_current,
        taskTitle,
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

    // Auto-start break timer after a moment
    setTimeout(() => {
      const state = get();
      if (state.isBreak && state.timerState === 'break') {
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

    // Add feedback and recalibrate in memory
    let updatedGoal = { ...goal };
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
    const updated = storage.updateSettings(settings);
    if (updated) {
      set({ user: updated });
      get().addToast('Settings saved', 'success');
      cloudSync(() => api.updateSettings(settings));
    }
  },

  addToast: (message, type = 'info') => {
    const toast: Toast = { id: generateId(), message, type, duration: 3000 };
    set(state => ({ toasts: [...state.toasts, toast] }));
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

    // Sync to localStorage and cloud
    storage.createDailyTask(title, pomodorosTarget, repeating, tag);
    cloudSync(() => api.createDailyTask(title, pomodorosTarget, repeating, tag));
  },

  addDailyTaskForDate: (title, date, pomodorosTarget = 1, repeating = false, tag, goalId) => {
    const now = new Date().toISOString();

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
      order: get().dailyTasks.length,
    };

    // If the task is for the currently viewed date, append to store
    // Otherwise, sync to storage/cloud only
    if (date === get().dailyViewDate) {
      set({
        dailyTasks: [...get().dailyTasks, newTask],
      });
    }

    // Sync to localStorage and cloud
    storage.createDailyTaskForDate(title, date, pomodorosTarget, repeating, tag);
    cloudSync(() => api.createDailyTaskForDate(title, date, pomodorosTarget, repeating, tag));
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

  // ─── Subscription ────────────────────────────────────────────────

  fetchSubscriptionStatus: async () => {
    set({ subscriptionLoading: true });
    try {
      const res = await fetch('/api/subscription/status');
      if (!res.ok) {
        set({ subscription: { status: 'none' }, subscriptionLoading: false });
        return;
      }
      const data = await res.json();
      set({
        subscription: {
          status: data.status,
          razorpay_subscription_id: data.razorpay_subscription_id,
          plan_id: data.plan_id,
          trial_ends_at: data.trial_ends_at,
          current_period_end: data.current_period_end,
          cancelled_at: data.cancelled_at,
          created_at: data.created_at,
        },
        subscriptionLoading: false,
      });
    } catch {
      set({ subscription: { status: 'none' }, subscriptionLoading: false });
    }
  },

  startTrial: async (opts) => {
    try {
      const res = await fetch('/api/subscription/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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

      // Open Razorpay checkout
      if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).Razorpay) {
        const RazorpayConstructor = (window as unknown as Record<string, new (opts: Record<string, unknown>) => { open: () => void }>).Razorpay;
        const rzp = new RazorpayConstructor({
          key: data.key_id,
          subscription_id: data.subscription_id,
          name: 'EffortOS',
          description: '3-day free trial, then ₹499/mo',
          handler: async (response: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => {
            // Verify payment
            const verifyRes = await fetch('/api/subscription/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(response),
            });
            if (verifyRes.ok) {
              set({
                subscription: {
                  status: 'trialing',
                  razorpay_subscription_id: data.subscription_id,
                  trial_ends_at: data.trial_ends_at,
                },
                showPaywall: false,
              });
              get().addToast('Trial started! You have 3 days of full access.', 'success');
            } else {
              get().addToast('Payment verification failed. Please try again.', 'error');
            }
          },
          theme: { color: '#06b6d4' },
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

  setShowPaywall: (show) => set({ showPaywall: show }),

  isSubscriptionActive: () => {
    const { subscription } = get();
    return subscription.status === 'trialing' || subscription.status === 'active';
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
