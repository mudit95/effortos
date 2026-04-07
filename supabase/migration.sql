-- EffortOS Database Migration
-- Run this in Supabase Dashboard → SQL Editor → New Query → Paste & Run

-- ============================================================
-- 1. PROFILES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,

  -- Settings (embedded)
  focus_duration    INT NOT NULL DEFAULT 1500,
  break_duration    INT NOT NULL DEFAULT 300,
  long_break_duration INT NOT NULL DEFAULT 900,
  notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  sound_enabled     BOOLEAN NOT NULL DEFAULT true,
  theme             TEXT NOT NULL DEFAULT 'dark',

  -- Subscription
  subscription_tier TEXT NOT NULL DEFAULT 'free',
  razorpay_customer_id TEXT,
  subscription_ends_at TIMESTAMPTZ,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- ============================================================
-- 2. GOALS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.goals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,

  estimated_sessions_initial  INT NOT NULL,
  estimated_sessions_current  INT NOT NULL,
  sessions_completed          INT NOT NULL DEFAULT 0,
  user_time_bias              REAL NOT NULL DEFAULT 0,
  experience_level            TEXT NOT NULL DEFAULT 'intermediate',
  daily_availability          REAL NOT NULL DEFAULT 2,
  deadline                    TIMESTAMPTZ,
  consistency_level           TEXT NOT NULL DEFAULT 'medium',
  confidence_score            REAL NOT NULL DEFAULT 0.6,
  difficulty                  TEXT NOT NULL DEFAULT 'moderate',
  recommended_sessions_per_day INT NOT NULL DEFAULT 2,
  estimated_days              INT NOT NULL,

  status            TEXT NOT NULL DEFAULT 'active',
  paused_at         TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_user_id ON public.goals(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_status ON public.goals(user_id, status);

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own goals" ON public.goals FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- 3. MILESTONES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.milestones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id         UUID NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  session_target  INT NOT NULL,
  completed       BOOLEAN NOT NULL DEFAULT false,
  completed_at    TIMESTAMPTZ,
  sort_order      INT NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_milestones_goal ON public.milestones(goal_id);

ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own milestones" ON public.milestones FOR ALL
  USING (goal_id IN (SELECT id FROM public.goals WHERE user_id = auth.uid()));

-- ============================================================
-- 4. FEEDBACK ENTRIES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.feedback_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id         UUID NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  bias            REAL NOT NULL,
  sessions_at_time INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_goal ON public.feedback_entries(goal_id);

ALTER TABLE public.feedback_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own feedback" ON public.feedback_entries FOR ALL
  USING (goal_id IN (SELECT id FROM public.goals WHERE user_id = auth.uid()));

-- ============================================================
-- 5. SESSIONS TABLE (Pomodoro sessions)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id         UUID REFERENCES public.goals(id) ON DELETE SET NULL,
  daily_task_id   UUID,
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ,
  duration        INT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  notes           TEXT,
  manual          BOOLEAN NOT NULL DEFAULT false,
  device          TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_goal ON public.sessions(goal_id);
CREATE INDEX IF NOT EXISTS idx_sessions_daily_task ON public.sessions(daily_task_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON public.sessions(user_id, start_time);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own sessions" ON public.sessions FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- 6. DAILY TASKS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.daily_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  completed       BOOLEAN NOT NULL DEFAULT false,
  repeating       BOOLEAN NOT NULL DEFAULT false,
  pomodoros_target INT NOT NULL DEFAULT 1,
  pomodoros_done   INT NOT NULL DEFAULT 0,
  date            DATE NOT NULL,
  tag             TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  completed_at    TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_tasks_user_date ON public.daily_tasks(user_id, date);

ALTER TABLE public.daily_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own daily tasks" ON public.daily_tasks FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- 7. REPEATING TEMPLATES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.repeating_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  pomodoros_target INT NOT NULL DEFAULT 1,
  tag             TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repeating_user ON public.repeating_templates(user_id);

ALTER TABLE public.repeating_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own templates" ON public.repeating_templates FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- 8. TIMER STATE TABLE (one row per user, upserted)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.timer_state (
  user_id         UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id         UUID,
  daily_task_id   UUID,
  remaining       INT NOT NULL,
  is_running      BOOLEAN NOT NULL DEFAULT false,
  is_break        BOOLEAN NOT NULL DEFAULT false,
  session_id      UUID,
  device          TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.timer_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own timer" ON public.timer_state FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- 9. AUTO-CREATE PROFILE ON SIGN-UP (Database Trigger)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, timezone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'timezone', 'UTC')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 10. UPDATED_AT AUTO-UPDATE FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER goals_updated_at BEFORE UPDATE ON public.goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER timer_state_updated_at BEFORE UPDATE ON public.timer_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
