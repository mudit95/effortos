'use client';

import { create } from 'zustand';
import {
  User, Goal, Session, TimerState, OnboardingData,
  DashboardStats, RecalibrationResult, Toast, UserSettings, DEFAULT_SETTINGS,
  DashboardMode, DailyTask, RepeatingTaskTemplate, TaskTagId,
} from '@/types';
import * as storage from '@/lib/storage';
import { estimateEffort, recalibrate, shouldTriggerFeedback, calculateTimeBias } from '@/lib/estimation';
import { getStreaks, sessionsToHours, generateId } from '@/lib/utils';
import { playSound } from '@/lib/sounds';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { resetProvider as resetDataLayerProvider, migrateLocalDataToCloud } from '@/lib/dataLayer';
import * as api from '@/lib/api';

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
  addDailyTask: (title: string, pomodorosTarget?: number, repeating?: boolean, tag?: TaskTagId) => void;
  addDailyTaskForDate: (title: string, date: string, pomodorosTarget?: number, repeating?: boolean, tag?: TaskTagId) => void;
  toggleTaskComplete: (taskId: string) => void;
  deleteDailyTask: (taskId: string) => void;
  setActiveDailyTask: (taskId: string | null) => void;
  completeDailyPomodoro: () => void;
  setDailyViewDate: (date: string) => void;
  refreshDailyTasks: () => void;
  removeRepeatingTemplate: (templateId: string) => void;
  updateDailyTaskDetails: (taskId: string, updates: Partial<DailyTask>) => void;

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
  onboardingStep: 0,
  onboardingData: {},
  currentView: 'landing',

  initializeApp: async () => {
    let isCloud = false;

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
          // Convert Supabase profile to local User shape
          const supaUser = {
            id: profile.id,
            name: profile.name || session.user.user_metadata?.name || '',
            email: profile.email || session.user.email || '',
            timezone: profile.timezone || 'UTC',
            created_at: profile.created_at,
            onboarding_completed: profile.onboarding_completed,
            avatar_url: profile.avatar_url,
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

          // Check if there's local data from demo mode to migrate
          const localGoals = storage.getGoals();
          if (localGoals.length > 0) {
            migrateLocalDataToCloud().catch(() => {});
          }

          // ── Cloud path: load data from Supabase ──
          const cloudGoals = await api.getGoals();
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
            currentView: cloudActiveGoal ? 'dashboard' : (supaUser.onboarding_completed ? 'dashboard' : 'onboarding'),
          });

          if (cloudActiveGoal) get().refreshDashboard();
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
    // Sign out of Supabase if connected
    if (isSupabaseConfigured()) try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // Continue with local logout even if Supabase fails
    }
    storage.clearAllData();
    set({
      user: null,
      isAuthenticated: false,
      activeGoal: null,
      goals: [],
      timerState: 'idle',
      timeRemaining: 25 * 60,
      currentSessionId: null,
      dashboardStats: null,
      currentView: 'landing',
    });
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

    const goal = get().createNewGoal(onboardingData as OnboardingData);
    storage.updateUser({ onboarding_completed: true });

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

    const estimation = estimateEffort({
      goal: data.goalTitle,
      experience_level: data.experienceLevel,
      daily_availability: data.dailyAvailability,
      deadline: data.deadline,
      consistency_level: data.consistencyLevel,
      user_time_estimate: data.userTimeEstimate,
    });

    const timeBias = calculateTimeBias(data.userTimeEstimate, estimation.estimated_sessions);

    const goal = storage.createGoal({
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
      status: 'active',
    });

    const goals = storage.getGoals();
    set({ goals, activeGoal: goal });

    // Write-through: create goal in Supabase
    cloudSync(() => api.createGoal({
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
      status: 'active',
    }));

    return goal;
  },

  updateGoalDetails: (goalId, title, description) => {
    storage.updateGoal(goalId, { title, description });
    const goal = storage.getGoalById(goalId);
    set({ activeGoal: goal, goals: storage.getGoals(), showEditGoal: false });
    get().addToast('Goal updated', 'success');
    cloudSync(() => api.updateGoal(goalId, { title, description }));
  },

  pauseGoal: (goalId) => {
    storage.pauseGoal(goalId);
    const goals = storage.getGoals();
    const active = goals.find(g => g.status === 'active') || null;
    set({ goals, activeGoal: active });
    get().addToast('Goal paused', 'info');
    get().refreshDashboard();
    cloudSync(() => api.pauseGoal(goalId));
  },

  resumeGoal: (goalId) => {
    // Pause any other active goal first
    const goals = storage.getGoals();
    goals.forEach(g => {
      if (g.status === 'active' && g.id !== goalId) {
        storage.pauseGoal(g.id);
        cloudSync(() => api.pauseGoal(g.id));
      }
    });
    storage.resumeGoal(goalId);
    const updatedGoals = storage.getGoals();
    const active = updatedGoals.find(g => g.id === goalId) || null;
    set({ goals: updatedGoals, activeGoal: active });
    get().addToast('Goal resumed', 'success');
    get().refreshDashboard();
    cloudSync(() => api.resumeGoal(goalId));
  },

  switchToGoal: (goalId) => {
    const goal = storage.getGoalById(goalId);
    if (!goal) return;
    if (goal.status === 'paused') {
      get().resumeGoal(goalId);
    } else {
      set({ activeGoal: goal });
      get().refreshDashboard();
    }
  },

  updateGoalProgress: (goalId) => {
    const goal = storage.getGoalById(goalId);
    if (!goal) return;

    const newCompleted = goal.sessions_completed + 1;
    const updates: Partial<Goal> = { sessions_completed: newCompleted };

    // Check milestones
    const updatedMilestones = goal.milestones.map(m => {
      if (!m.completed && newCompleted >= m.session_target) {
        return { ...m, completed: true, completed_at: new Date().toISOString() };
      }
      return m;
    });
    updates.milestones = updatedMilestones;

    // Check milestone just completed for toast
    const justCompleted = updatedMilestones.find(
      m => m.session_target === newCompleted && m.completed_at
    );
    if (justCompleted) {
      get().addToast(`Milestone reached: ${justCompleted.title}!`, 'success');
    }

    // Check if goal is complete
    if (newCompleted >= goal.estimated_sessions_current) {
      updates.status = 'completed';
      updates.completed_at = new Date().toISOString();
    }

    const updated = storage.updateGoal(goalId, updates);
    if (!updated) return;

    // Recalibrate
    const recalResult = recalibrate(updated);
    const prevEstimate = updated.estimated_sessions_current;
    const newEstimate = updated.sessions_completed + recalResult.remaining_sessions;

    storage.updateGoal(goalId, {
      estimated_sessions_current: newEstimate,
    });

    // Show recalibration toast if estimate changed meaningfully
    if (Math.abs(newEstimate - prevEstimate) >= 2 && updated.sessions_completed >= 5) {
      get().addToast(
        `Estimate adjusted: ${prevEstimate} → ${newEstimate} sessions`,
        'info'
      );
    }

    // Check if feedback should be triggered
    const needsFeedback = shouldTriggerFeedback(updated);

    const refreshedGoal = storage.getGoalById(goalId);

    // Show celebration if completed
    const isNowComplete = refreshedGoal?.status === 'completed';

    set({
      activeGoal: refreshedGoal,
      goals: storage.getGoals(),
      recalibrationResult: recalResult,
      showFeedback: needsFeedback && !isNowComplete,
      feedbackGoalId: needsFeedback && !isNowComplete ? goalId : null,
      showCelebration: isNowComplete,
    });

    get().refreshDashboard();
  },

  completeGoal: (goalId) => {
    storage.updateGoal(goalId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
    set({
      goals: storage.getGoals(),
      currentView: 'dashboard',
    });
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
    const { currentSessionId, activeGoal, user, dashboardMode, activeDailyTaskId } = get();
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
      const updated = storage.incrementTaskPomodoro(activeDailyTaskId);
      if (updated) {
        set({ dailyTasks: storage.getDailyTasksForDate(get().dailyViewDate) });
        if (updated.completed) {
          get().addToast(`"${updated.title}" complete!`, 'success');
        }
      }
      // Write-through: increment daily task pomodoro in Supabase
      cloudSync(() => api.incrementTaskPomodoro(activeDailyTaskId));
    }

    // Play pomodoro complete sound
    if (user?.settings?.sound_enabled !== false) {
      playSound('pomodoro_complete');
    }

    // Send notification
    get().sendNotification('Session complete!', 'Great work. Take a break.');

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
    const { feedbackGoalId, activeGoal } = get();
    if (!feedbackGoalId) return;

    storage.addFeedback(feedbackGoalId, bias);
    cloudSync(() => api.addFeedback(feedbackGoalId, bias));

    const goal = storage.getGoalById(feedbackGoalId);
    if (goal) {
      const result = recalibrate(goal);
      const prevEstimate = goal.estimated_sessions_current;
      const newEstimate = goal.sessions_completed + result.remaining_sessions;
      storage.updateGoal(feedbackGoalId, {
        estimated_sessions_current: newEstimate,
      });

      if (prevEstimate !== newEstimate) {
        get().addToast(`Estimate updated: ${prevEstimate} → ${newEstimate} sessions`, 'success');
      } else {
        get().addToast('Feedback recorded. Estimate unchanged.', 'info');
      }

      set({
        activeGoal: storage.getGoalById(feedbackGoalId),
        recalibrationResult: result,
      });
    }

    set({ showFeedback: false, feedbackGoalId: null });
    get().refreshDashboard();
  },

  dismissFeedback: () => {
    set({ showFeedback: false, feedbackGoalId: null });
  },

  submitSessionNotes: (notes) => {
    // Find the most recent completed session and add notes
    const { activeGoal } = get();
    if (!activeGoal) return;
    const sessions = storage.getCompletedSessions(activeGoal.id);
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

  addDailyTask: (title, pomodorosTarget = 1, repeating = false, tag) => {
    storage.createDailyTask(title, pomodorosTarget, repeating, tag);
    const todayKey = new Date().toISOString().split('T')[0];
    set({
      dailyTasks: storage.getDailyTasksForDate(todayKey),
      repeatingTemplates: storage.getRepeatingTemplates().filter(t => t.active),
    });
    cloudSync(() => api.createDailyTask(title, pomodorosTarget, repeating, tag));
  },

  addDailyTaskForDate: (title, date, pomodorosTarget = 1, repeating = false, tag) => {
    storage.createDailyTaskForDate(title, date, pomodorosTarget, repeating, tag);
    set({
      dailyTasks: storage.getDailyTasksForDate(get().dailyViewDate),
      repeatingTemplates: storage.getRepeatingTemplates().filter(t => t.active),
    });
    cloudSync(() => api.createDailyTaskForDate(title, date, pomodorosTarget, repeating, tag));
  },

  toggleTaskComplete: (taskId) => {
    storage.toggleDailyTaskComplete(taskId);
    set({ dailyTasks: storage.getDailyTasksForDate(get().dailyViewDate) });

    const task = storage.getAllDailyTasks().find(t => t.id === taskId);
    if (task?.completed) {
      get().addToast(`"${task.title}" done!`, 'success');
    }
    cloudSync(() => api.toggleDailyTaskComplete(taskId));
  },

  deleteDailyTask: (taskId) => {
    storage.deleteDailyTask(taskId);
    set({
      dailyTasks: storage.getDailyTasksForDate(get().dailyViewDate),
      activeDailyTaskId: get().activeDailyTaskId === taskId ? null : get().activeDailyTaskId,
    });
    cloudSync(() => api.deleteDailyTask(taskId));
  },

  setActiveDailyTask: (taskId) => {
    set({ activeDailyTaskId: taskId });
  },

  completeDailyPomodoro: () => {
    const { activeDailyTaskId, user } = get();
    if (!activeDailyTaskId) return;

    const updated = storage.incrementTaskPomodoro(activeDailyTaskId);
    if (updated) {
      set({ dailyTasks: storage.getDailyTasksForDate(get().dailyViewDate) });

      if (updated.completed) {
        get().addToast(`"${updated.title}" complete!`, 'success');
      }
    }
    cloudSync(() => api.incrementTaskPomodoro(activeDailyTaskId));

    // Play pomodoro complete sound
    if (user?.settings?.sound_enabled !== false) {
      playSound('pomodoro_complete');
    }

    // Send notification
    get().sendNotification('Pomodoro complete!', 'Great work. Take a break.');
  },

  setDailyViewDate: (date) => {
    const tasks = storage.ensureRepeatingTasksForDate(date);
    set({ dailyViewDate: date, dailyTasks: tasks });
  },

  refreshDailyTasks: () => {
    const { dailyViewDate } = get();
    set({ dailyTasks: storage.getDailyTasksForDate(dailyViewDate) });
  },

  removeRepeatingTemplate: (templateId) => {
    storage.removeRepeatingTemplate(templateId);
    set({ repeatingTemplates: storage.getRepeatingTemplates().filter(t => t.active) });
    cloudSync(() => api.removeRepeatingTemplate(templateId));
  },

  updateDailyTaskDetails: (taskId, updates) => {
    storage.updateDailyTask(taskId, updates);
    set({ dailyTasks: storage.getDailyTasksForDate(get().dailyViewDate) });
    cloudSync(() => api.updateDailyTask(taskId, updates));
  },

  refreshDashboard: () => {
    const { activeGoal } = get();
    if (!activeGoal) {
      set({ dashboardStats: null });
      return;
    }

    const dailySessions = storage.getDailySessions(activeGoal.id);
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
