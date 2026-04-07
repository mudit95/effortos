# EffortOS — System Architecture Spec

**Version:** 1.0
**Date:** April 7, 2026
**Status:** Proposed

---

## 1. Overview

EffortOS is evolving from a client-side web app (localStorage) into a cross-platform product with a cloud backend, web dashboard, and native mobile apps (iOS/Android). This document covers the database schema, API design, authentication, mobile architecture, and migration path from the current implementation.

### Current State

- Next.js 16 web app, React 19, TypeScript
- Zustand store for state management
- localStorage for persistence (no backend)
- Web Worker for timer reliability
- PWA with Document PiP floating timer

### Target State

- Supabase backend (Postgres + Auth + Realtime)
- Next.js web app consuming REST API
- Expo/React Native mobile apps (iOS + Android)
- Real-time sync across all devices
- Subscription billing via Razorpay

---

## 2. Architecture Diagram

```
┌────────────────────────────────────────────────────────────┐
│                        CLIENTS                              │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Web App      │  │  iOS App     │  │  Android App     │  │
│  │  (Next.js)    │  │  (Expo)      │  │  (Expo)          │  │
│  │  Zustand +    │  │  Zustand +   │  │  Zustand +       │  │
│  │  React Query  │  │  React Query │  │  React Query     │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                  │                    │            │
└─────────┼──────────────────┼────────────────────┼───────────┘
          │                  │                    │
          ▼                  ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                     SUPABASE PLATFORM                        │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Auth         │  │  REST API    │  │  Realtime          │  │
│  │  (Email/Pass  │  │  (PostgREST) │  │  (WebSockets)      │  │
│  │   + OAuth)    │  │              │  │                     │  │
│  └──────────────┘  └──────┬───────┘  └───────────────────┘  │
│                           │                                  │
│                    ┌──────▼───────┐                           │
│                    │  PostgreSQL   │                           │
│                    │  Database     │                           │
│                    └──────────────┘                           │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐                          │
│  │  Edge Funcs   │  │  Storage     │                          │
│  │  (Webhooks,   │  │  (Avatars)   │                          │
│  │   Razorpay)   │  │              │                          │
│  └──────────────┘  └──────────────┘                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────┐
│  Razorpay            │
│  (Subscriptions)     │
└─────────────────────┘
```

---

## 3. Database Schema

All tables use Supabase Auth's `auth.users` for identity. The `user_id` field references `auth.users(id)` and Row Level Security (RLS) ensures users only access their own data.

### 3.1 `profiles`

User profile and settings. Created automatically on sign-up via a database trigger.

```sql
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  avatar_url    TEXT,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,

  -- Settings (embedded, not a separate table)
  focus_duration    INT NOT NULL DEFAULT 1500,    -- seconds
  break_duration    INT NOT NULL DEFAULT 300,     -- seconds
  long_break_duration INT NOT NULL DEFAULT 900,   -- seconds
  notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  sound_enabled     BOOLEAN NOT NULL DEFAULT true,
  theme             TEXT NOT NULL DEFAULT 'dark',

  -- Subscription
  subscription_tier TEXT NOT NULL DEFAULT 'free', -- free, pro, team
  razorpay_customer_id TEXT,
  subscription_ends_at TIMESTAMPTZ,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: Users can only read/update their own profile
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
```

### 3.2 `goals`

Long-term goals with AI estimation metadata.

```sql
CREATE TABLE goals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,

  -- AI estimation fields
  estimated_sessions_initial  INT NOT NULL,
  estimated_sessions_current  INT NOT NULL,
  sessions_completed          INT NOT NULL DEFAULT 0,
  user_time_bias              REAL NOT NULL DEFAULT 0,  -- -2 to +2
  experience_level            TEXT NOT NULL DEFAULT 'intermediate',
  daily_availability          REAL NOT NULL DEFAULT 2,  -- hours
  deadline                    TIMESTAMPTZ,
  consistency_level           TEXT NOT NULL DEFAULT 'medium',
  confidence_score            REAL NOT NULL DEFAULT 0.6,
  difficulty                  TEXT NOT NULL DEFAULT 'moderate',
  recommended_sessions_per_day INT NOT NULL DEFAULT 2,
  estimated_days              INT NOT NULL,

  -- Status
  status            TEXT NOT NULL DEFAULT 'active',  -- active, paused, completed, abandoned
  paused_at         TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_goals_user_id ON goals(user_id);
CREATE INDEX idx_goals_status ON goals(user_id, status);

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own goals" ON goals FOR ALL USING (auth.uid() = user_id);
```

### 3.3 `milestones`

Separate table for goal milestones (1:N relationship).

```sql
CREATE TABLE milestones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id         UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  session_target  INT NOT NULL,
  completed       BOOLEAN NOT NULL DEFAULT false,
  completed_at    TIMESTAMPTZ,
  sort_order      INT NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_milestones_goal ON milestones(goal_id);

ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own milestones" ON milestones FOR ALL
  USING (goal_id IN (SELECT id FROM goals WHERE user_id = auth.uid()));
```

### 3.4 `feedback_entries`

Feedback bias log for adaptive recalibration (1:N from goals).

```sql
CREATE TABLE feedback_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id         UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  bias            REAL NOT NULL,          -- -2 to +2
  sessions_at_time INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_goal ON feedback_entries(goal_id);

ALTER TABLE feedback_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own feedback" ON feedback_entries FOR ALL
  USING (goal_id IN (SELECT id FROM goals WHERE user_id = auth.uid()));
```

### 3.5 `sessions`

Pomodoro sessions (both long-term goal sessions and daily grind sessions).

```sql
CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  goal_id         UUID,                   -- NULL for daily-mode / unassigned sessions
  daily_task_id   UUID,                   -- NULL for long-term goal sessions
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ,
  duration        INT NOT NULL,           -- seconds
  status          TEXT NOT NULL DEFAULT 'active', -- active, completed, discarded, paused
  notes           TEXT,
  manual          BOOLEAN NOT NULL DEFAULT false,
  device          TEXT,                   -- 'web', 'ios', 'android'

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_goal ON sessions(goal_id);
CREATE INDEX idx_sessions_daily_task ON sessions(daily_task_id);
CREATE INDEX idx_sessions_date ON sessions(user_id, start_time);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own sessions" ON sessions FOR ALL USING (auth.uid() = user_id);
```

### 3.6 `daily_tasks`

Tasks in the Daily Grind view.

```sql
CREATE TABLE daily_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  completed       BOOLEAN NOT NULL DEFAULT false,
  repeating       BOOLEAN NOT NULL DEFAULT false,
  pomodoros_target INT NOT NULL DEFAULT 1,
  pomodoros_done   INT NOT NULL DEFAULT 0,
  date            DATE NOT NULL,           -- the day this task belongs to
  tag             TEXT,                    -- startup, job, learning, personal, health, creative
  sort_order      INT NOT NULL DEFAULT 0,
  completed_at    TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_daily_tasks_user_date ON daily_tasks(user_id, date);

ALTER TABLE daily_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own daily tasks" ON daily_tasks FOR ALL USING (auth.uid() = user_id);
```

### 3.7 `repeating_templates`

Templates that auto-generate daily tasks each day.

```sql
CREATE TABLE repeating_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  pomodoros_target INT NOT NULL DEFAULT 1,
  tag             TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_repeating_user ON repeating_templates(user_id);

ALTER TABLE repeating_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own templates" ON repeating_templates FOR ALL USING (auth.uid() = user_id);
```

### 3.8 `timer_state`

Persisted timer state for cross-device resume. One row per user, upserted.

```sql
CREATE TABLE timer_state (
  user_id         UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  goal_id         UUID,
  daily_task_id   UUID,
  remaining       INT NOT NULL,           -- seconds remaining
  is_running      BOOLEAN NOT NULL DEFAULT false,
  is_break        BOOLEAN NOT NULL DEFAULT false,
  session_id      UUID,
  device          TEXT,                   -- which device is running the timer
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE timer_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own timer" ON timer_state FOR ALL USING (auth.uid() = user_id);
```

---

## 4. API Design

We use Supabase's auto-generated REST API (PostgREST) for standard CRUD, and Next.js API routes (Edge Functions) for business logic that needs server-side computation.

### 4.1 Auth Endpoints (Supabase Auth — built-in)

| Action | Method |
|--------|--------|
| Sign up (email/password) | `supabase.auth.signUp()` |
| Sign in (email/password) | `supabase.auth.signInWithPassword()` |
| Sign in (Google OAuth) | `supabase.auth.signInWithOAuth({ provider: 'google' })` |
| Sign in (Apple OAuth) | `supabase.auth.signInWithOAuth({ provider: 'apple' })` |
| Sign out | `supabase.auth.signOut()` |
| Reset password | `supabase.auth.resetPasswordForEmail()` |
| Get current user | `supabase.auth.getUser()` |

### 4.2 Data Endpoints (PostgREST — auto-generated)

All endpoints require an authenticated JWT. RLS enforces access control.

**Profiles:**
- `GET /rest/v1/profiles?id=eq.{userId}` — Get profile
- `PATCH /rest/v1/profiles?id=eq.{userId}` — Update profile/settings

**Goals:**
- `GET /rest/v1/goals?user_id=eq.{userId}&status=eq.active` — List active goals
- `GET /rest/v1/goals?user_id=eq.{userId}&select=*,milestones(*),feedback_entries(*)` — Goal with relations
- `POST /rest/v1/goals` — Create goal
- `PATCH /rest/v1/goals?id=eq.{goalId}` — Update goal
- `DELETE /rest/v1/goals?id=eq.{goalId}` — Delete goal

**Sessions:**
- `GET /rest/v1/sessions?user_id=eq.{userId}&start_time=gte.{date}` — Sessions in range
- `POST /rest/v1/sessions` — Create session
- `PATCH /rest/v1/sessions?id=eq.{sessionId}` — Update session (complete/discard)

**Daily Tasks:**
- `GET /rest/v1/daily_tasks?user_id=eq.{userId}&date=eq.{date}&order=sort_order` — Tasks for date
- `POST /rest/v1/daily_tasks` — Create task
- `PATCH /rest/v1/daily_tasks?id=eq.{taskId}` — Update task
- `DELETE /rest/v1/daily_tasks?id=eq.{taskId}` — Delete task

**Timer State:**
- `GET /rest/v1/timer_state?user_id=eq.{userId}` — Get current timer
- `POST /rest/v1/timer_state` (upsert) — Save timer state

### 4.3 Custom API Routes (Next.js Edge/Server Functions)

These handle business logic that shouldn't run client-side:

```
POST /api/goals/estimate
  Body: { goalTitle, experienceLevel, dailyAvailability, deadline?, consistencyLevel, userTimeEstimate? }
  Returns: EstimationOutput (sessions, confidence, milestones, etc.)
  Purpose: AI effort estimation (keeps algorithm server-side)

POST /api/goals/{id}/recalibrate
  Returns: RecalibrationResult
  Purpose: Adaptive recalibration after sessions

POST /api/daily-tasks/ensure-repeating
  Body: { date: "YYYY-MM-DD" }
  Returns: DailyTask[]
  Purpose: Create today's tasks from repeating templates (idempotent)

POST /api/sessions/complete
  Body: { sessionId, duration, notes?, dailyTaskId? }
  Purpose: Complete a session + update goal progress + check milestones + trigger feedback (atomic)

POST /api/reports/aggregate
  Body: { period: "daily" | "weekly" | "monthly", date: "YYYY-MM-DD" }
  Returns: { pomodoros, focusMinutes, tasksDone, avgPerDay, byTag, byDay, bestDay }
  Purpose: Pre-computed analytics (avoids heavy client-side computation)

POST /api/webhooks/razorpay
  Purpose: Handle subscription events (payment authorized, charged, cancelled, etc.)
```

---

## 5. Authentication Flow

### 5.1 Web App

```
User visits effortos.com
  → Not authenticated? Show landing page with Sign Up / Sign In
  → Sign Up: email + password → Supabase creates auth.users row
    → DB trigger creates profiles row with defaults
    → Redirect to onboarding
  → Sign In: email + password → JWT stored in httpOnly cookie via @supabase/ssr
    → Redirect to dashboard
  → OAuth: "Sign in with Google/Apple" → Same flow, profile populated from OAuth data
```

### 5.2 Mobile App

```
User opens app
  → Not authenticated? Show sign-in screen
  → Sign Up/In: Same Supabase auth, token stored in SecureStore (Expo)
  → OAuth: Deep link flow via Expo AuthSession
  → JWT refreshed automatically by Supabase client
```

### 5.3 Session Management

- Web: httpOnly cookies via `@supabase/ssr` (already in package.json)
- Mobile: `expo-secure-store` for token persistence
- Token refresh: Supabase handles automatically (1-hour access token, 7-day refresh)
- Logout: Clear tokens on all devices (Supabase `signOut({ scope: 'global' })`)

---

## 6. Mobile App Architecture

### 6.1 Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Expo SDK 52+ | Managed workflow, OTA updates, EAS Build for stores |
| Navigation | Expo Router | File-based routing (matches Next.js mental model) |
| State | Zustand | Same store shape as web — shared logic |
| Data fetching | TanStack React Query | Caching, background refetch, offline support |
| Styling | NativeWind (TailwindCSS) | Same utility classes as web |
| Auth | Supabase + Expo SecureStore | Secure token storage |
| Notifications | expo-notifications | Timer completion alerts |
| Background | None (intentional) | Timer stops when app backgrounds — this is a feature |

### 6.2 Screen Map

```
├── (auth)/
│   ├── sign-in.tsx
│   ├── sign-up.tsx
│   └── forgot-password.tsx
├── (tabs)/
│   ├── daily.tsx          — Daily Grind (task list + timer)
│   ├── goals.tsx          — Long-term goals list
│   ├── reports.tsx        — Visual reports
│   └── settings.tsx       — Profile, preferences, subscription
├── timer/
│   └── [id].tsx           — Full-screen timer (push when starting pomodoro)
├── goal/
│   ├── [id].tsx           — Goal detail + recalibration
│   └── new.tsx            — Onboarding / new goal creation
└── _layout.tsx            — Tab bar + auth guard
```

### 6.3 Timer Behavior on Mobile

This is a key product decision: **navigating away from the app stops the timer.**

Implementation:

```typescript
// In the Timer screen component:
import { AppState } from 'react-native';

useEffect(() => {
  const subscription = AppState.addEventListener('change', (nextState) => {
    if (nextState !== 'active') {
      // App went to background — pause timer, save state
      pauseTimer();
      saveTimerStateToServer();
      // Show a local notification warning
      Notifications.scheduleNotificationAsync({
        content: { title: 'Timer paused', body: 'Return to EffortOS to continue your session' },
        trigger: null, // immediate
      });
    }
  });
  return () => subscription.remove();
}, []);
```

When the user returns to the app, the timer screen shows "Session paused" with a resume button. This enforces intentional focus — the whole point of EffortOS.

### 6.4 Offline Support

The mobile app should work with spotty connectivity:

- **Zustand + MMKV**: Local state cached to device storage
- **React Query**: Mutations queued when offline, replayed when online
- **Conflict resolution**: Server timestamp wins (last-write-wins). Timer state uses device field to prevent cross-device conflicts.

---

## 7. Real-Time Sync

Supabase Realtime enables live sync across devices.

### 7.1 What Syncs in Real-Time

| Data | Sync Strategy |
|------|---------------|
| Timer state | Realtime subscription on `timer_state` table. When user starts timer on phone, web dashboard updates instantly. |
| Daily tasks | Realtime on `daily_tasks` filtered by `user_id` and `date`. Adding a task on web appears on mobile. |
| Sessions | React Query invalidation after mutation. Not real-time (no need). |
| Goals | React Query invalidation. Not real-time (rarely changes mid-session). |

### 7.2 Timer Conflict Resolution

Only one device can run the timer at a time:

```
1. User starts timer on Phone
   → UPSERT timer_state: { device: 'ios', is_running: true, remaining: 1500 }

2. User opens Web while phone timer is running
   → Web reads timer_state, sees device='ios', is_running=true
   → Web shows: "Timer running on your iPhone" with remaining time (read-only countdown)
   → Web offers: "Take over timer on this device?" button

3. If user takes over:
   → UPSERT timer_state: { device: 'web', is_running: true, remaining: <current> }
   → Phone receives realtime update, shows "Timer moved to web"
```

---

## 8. Migration Path (localStorage → Supabase)

### Phase 1: Add Supabase Auth (keep localStorage for data)

- Set up Supabase project
- Add sign-up/sign-in screens
- Profile creation on sign-up
- Existing localStorage data still works for logged-in users

### Phase 2: Create API Data Layer

- Add `src/lib/api.ts` — mirrors `storage.ts` interface but calls Supabase
- Create `src/lib/dataLayer.ts` — abstract that delegates to either `storage.ts` (offline) or `api.ts` (online)
- Update Zustand store to use `dataLayer` instead of `storage` directly

```typescript
// src/lib/dataLayer.ts
import * as storage from './storage';
import * as api from './api';
import { supabase } from './supabase';

async function getProvider() {
  const { data: { user } } = await supabase.auth.getUser();
  return user ? api : storage; // Authenticated? Use API. Otherwise localStorage.
}

export async function getGoals() {
  const provider = await getProvider();
  return provider.getGoals();
}
// ... same for all operations
```

### Phase 3: Data Migration Tool

On first authenticated login, migrate localStorage data to Supabase:

```typescript
async function migrateLocalData(userId: string) {
  const localGoals = storage.getGoals();
  const localSessions = storage.getSessions();
  const localTasks = storage.getAllDailyTasks();

  if (localGoals.length === 0 && localSessions.length === 0) return; // Nothing to migrate

  // Batch insert to Supabase
  await supabase.from('goals').insert(localGoals.map(g => ({ ...g, user_id: userId })));
  await supabase.from('sessions').insert(localSessions.map(s => ({ ...s, user_id: userId })));
  await supabase.from('daily_tasks').insert(localTasks.map(t => ({ ...t, user_id: userId })));

  // Clear localStorage after successful migration
  storage.clearAllData();
}
```

### Phase 4: Remove localStorage Dependency

Once API layer is stable, remove `storage.ts` calls from the Zustand store entirely. All state flows through the API.

---

## 9. Subscription & Billing

### 9.1 Tier Structure

| Feature | Free | Pro ($8/mo) |
|---------|------|-------------|
| Daily Grind tasks | 5/day | Unlimited |
| Long-term goals | 1 active | Unlimited |
| Pomodoro timer | Yes | Yes |
| Reports | Daily only | Daily + Weekly + Monthly |
| Manual pomodoro entry | No | Yes |
| PiP floating timer | No | Yes |
| Data export | No | CSV + JSON |
| Device sync | 1 device | Unlimited |

### 9.2 Razorpay Integration

Razorpay Subscriptions API handles recurring billing. Supports UPI, credit/debit cards, net banking, and wallets — all popular Indian payment methods.

```
Sign up (free tier) → Use app → Hit limit → Upgrade prompt
  → Create Razorpay Subscription (server-side)
  → Open Razorpay Checkout modal (client-side, razorpay.js)
  → Payment authorized → Webhook (subscription.charged) → Update profiles.subscription_tier = 'pro'
  → Close modal, refresh dashboard

Cancellation:
  → User clicks "Cancel Subscription" in settings
  → POST /api/subscriptions/cancel → Razorpay cancel API
  → Webhook (subscription.cancelled) → Set subscription_ends_at to current period end
  → Access continues until period ends
  → Downgrade to free

Webhook events to handle:
  - subscription.authenticated → Subscription created, pending first charge
  - subscription.charged → Payment successful, activate/renew
  - subscription.pending → Payment retry in progress
  - subscription.halted → All retries failed, downgrade to free
  - subscription.cancelled → User cancelled, set end date
```

**Mobile payments:** On iOS/Android, Razorpay's React Native SDK opens the same checkout flow. For iOS App Store compliance, in-app subscriptions may need to go through Apple IAP instead — this is a policy decision to evaluate at launch.

---

## 10. Project Structure

### 10.1 Web App (Updated)

```
effortos/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── goals/
│   │   │   │   ├── estimate/route.ts
│   │   │   │   └── [id]/recalibrate/route.ts
│   │   │   ├── sessions/complete/route.ts
│   │   │   ├── daily-tasks/ensure-repeating/route.ts
│   │   │   ├── reports/aggregate/route.ts
│   │   │   └── webhooks/razorpay/route.ts
│   │   ├── (auth)/
│   │   │   ├── sign-in/page.tsx
│   │   │   ├── sign-up/page.tsx
│   │   │   └── layout.tsx
│   │   ├── (dashboard)/
│   │   │   ├── page.tsx
│   │   │   └── layout.tsx
│   │   └── layout.tsx
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts       — Browser Supabase client
│   │   │   ├── server.ts       — Server-side Supabase client
│   │   │   └── middleware.ts   — Auth middleware for Next.js
│   │   ├── api.ts              — Supabase data operations
│   │   ├── storage.ts          — localStorage (kept for offline fallback)
│   │   ├── dataLayer.ts        — Abstraction over api.ts / storage.ts
│   │   ├── estimation.ts       — AI estimation engine
│   │   └── utils.ts
│   ├── store/
│   │   └── useStore.ts         — Updated to use dataLayer
│   ├── hooks/
│   │   ├── useTimer.ts
│   │   ├── usePiP.ts
│   │   └── useServiceWorker.ts
│   └── components/
│       └── ... (existing)
```

### 10.2 Mobile App (New Repo)

```
effortos-mobile/
├── app/
│   ├── (auth)/
│   │   ├── sign-in.tsx
│   │   └── sign-up.tsx
│   ├── (tabs)/
│   │   ├── daily.tsx
│   │   ├── goals.tsx
│   │   ├── reports.tsx
│   │   └── settings.tsx
│   ├── timer/[id].tsx
│   ├── goal/[id].tsx
│   └── _layout.tsx
├── src/
│   ├── lib/
│   │   ├── supabase.ts         — Mobile Supabase client
│   │   ├── api.ts              — Same interface as web api.ts
│   │   └── estimation.ts       — Shared (copy or monorepo)
│   ├── store/
│   │   └── useStore.ts         — Same shape as web, mobile-specific actions
│   ├── components/
│   │   ├── Timer.tsx
│   │   ├── TaskList.tsx
│   │   └── ...
│   └── hooks/
│       └── useTimer.ts         — Mobile timer (AppState aware)
├── app.json                    — Expo config
├── eas.json                    — EAS Build config
└── package.json
```

---

## 11. Build Order & Timeline

### Sprint 1 (Week 1): Supabase Setup + Auth

- Create Supabase project
- Run database migration SQL (all tables from Section 3)
- Set up RLS policies
- Implement sign-up/sign-in pages on web
- Add `@supabase/ssr` middleware for session management
- Profile creation trigger
- Test: User can sign up, sign in, see dashboard

### Sprint 2 (Week 2): API Layer + Web Migration

- Build `src/lib/api.ts` mirroring `storage.ts` interface
- Build `src/lib/dataLayer.ts` abstraction
- Update Zustand store to use `dataLayer`
- Implement localStorage → Supabase migration on first login
- Implement `/api/sessions/complete` (atomic session completion)
- Implement `/api/daily-tasks/ensure-repeating`
- Test: All existing features work with Supabase backend

### Sprint 3 (Week 3): Real-Time + Reports API

- Add Supabase Realtime subscriptions (timer_state, daily_tasks)
- Implement timer conflict resolution (multi-device)
- Build `/api/reports/aggregate` endpoint
- Move estimation engine to `/api/goals/estimate`
- Test: Two browser tabs stay in sync

### Sprint 4 (Weeks 4-5): Mobile App

- Scaffold Expo project with Expo Router
- Implement auth screens (sign-in, sign-up)
- Build Daily Grind tab (task list + timer)
- Build full-screen timer with AppState pause behavior
- Build Goals tab
- Build Reports tab
- Build Settings tab
- Test on Expo Go (iOS + Android)

### Sprint 5 (Week 6): Polish + Launch

- Razorpay subscription integration
- App Store / Play Store submission via EAS
- Landing page update with download links
- Data export feature (Pro tier)
- Performance optimization and error handling

---

## 12. Key Trade-offs & Decisions

### Supabase vs. Custom Backend

**Chose Supabase.** It provides auth, database, REST API, realtime, and storage out of the box. A custom Express/Fastify API would give more control but adds 2-3 weeks of development time for the same features. Supabase's free tier supports 50K monthly active users, which is more than enough for launch.

**Revisit when:** You need complex server-side logic (e.g., AI-powered estimation using an LLM), custom rate limiting, or multi-tenant team features.

### Expo vs. React Native CLI

**Chose Expo (Managed Workflow).** EAS Build handles iOS/Android compilation in the cloud — no Xcode or Android Studio needed on your machine. OTA updates let you push bug fixes without going through app review. The trade-off is less control over native modules, but EffortOS doesn't need custom native code.

**Revisit when:** You need a native module that Expo doesn't support (unlikely for a timer app).

### Monorepo vs. Separate Repos

**Chose Separate Repos** (web in `effortos/`, mobile in `effortos-mobile/`). A monorepo (Turborepo) would let you share TypeScript types and utility functions, but adds build complexity. At this stage, copying shared files (types, estimation engine) is simpler. The shared surface area is small — about 3 files.

**Revisit when:** Shared code exceeds 10+ files or you bring on multiple developers.

### Timer Stops on Background (Mobile)

**Chose intentional stop.** This is a product decision, not a technical limitation. Background timers are possible (expo-task-manager), but EffortOS's value proposition is focused effort. If the user can leave the app and the timer keeps running, they're not doing focused work. The timer stopping is a feature, not a bug.

**Revisit when:** User feedback strongly requests background timers (e.g., for tasks where the app is just a tracker, not a focus tool).

### Offline-First vs. Online-Required

**Chose online-preferred with offline fallback.** The mobile app caches the current day's tasks and active timer state locally. If offline, mutations queue and replay when connectivity returns. The web app falls back to localStorage if Supabase is unreachable. This avoids the complexity of full offline-first sync (CRDTs, conflict resolution) while still being usable on flaky connections.

**Revisit when:** A significant portion of users are frequently offline (e.g., commuters, developing markets).

---

## 13. Security Considerations

- All API access requires authenticated JWT (Supabase Auth)
- RLS on every table — users can only access their own data
- Razorpay webhooks validated with signature verification (HMAC SHA256)
- No sensitive data in URL parameters
- Mobile tokens in SecureStore (encrypted at rest)
- Rate limiting via Supabase's built-in limits (free tier: 500 req/sec)
- CORS configured for web domain only

---

## 14. Monitoring & Observability

- Supabase Dashboard: Database metrics, auth events, API logs
- Sentry: Error tracking for both web and mobile
- Vercel Analytics: Web performance (Core Web Vitals)
- Expo Updates: OTA deployment status
- Razorpay Dashboard: Revenue, churn, failed payments, UPI/card split

---

*This spec is a living document. Update it as architectural decisions change during implementation.*
