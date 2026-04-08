// EffortOS Type Definitions

export interface User {
  id: string;
  name: string;
  email: string;
  timezone: string;
  created_at: string;
  onboarding_completed: boolean;
  avatar_url?: string;
  settings: UserSettings;
}

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
}

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'warning';
  duration?: number;
}

// Daily Grind types
export type DashboardMode = 'daily' | 'longterm' | 'reports';

export const TASK_TAGS = [
  { id: 'startup', label: 'Startup', color: '#c026d3' },
  { id: 'job', label: 'Job', color: '#0ea5e9' },
  { id: 'learning', label: 'Learning', color: '#22c55e' },
  { id: 'personal', label: 'Personal', color: '#f59e0b' },
  { id: 'health', label: 'Health', color: '#ef4444' },
  { id: 'creative', label: 'Creative', color: '#8b5cf6' },
] as const;

export type TaskTagId = typeof TASK_TAGS[number]['id'];

export interface DailyTask {
  id: string;
  title: string;
  completed: boolean;
  repeating: boolean;
  pomodoros_target: number;   // how many pomodoros planned for this task
  pomodoros_done: number;     // how many completed
  date: string;               // YYYY-MM-DD
  tag?: TaskTagId;            // effort category
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
