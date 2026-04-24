# EffortOS — Developer Handoff Document

## What is EffortOS?

EffortOS is an AI-powered productivity app built around the Pomodoro technique. It helps users set long-term goals, estimates how many focused sessions they'll need using AI, tracks daily tasks, and proactively coaches them via WhatsApp. It runs as a Next.js PWA deployed on Vercel with Supabase as the backend.

**Live URL:** https://effortos-zeta.vercel.app

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| UI | React 19, Tailwind CSS 4, Framer Motion, Lucide icons |
| State | Zustand (single store: `src/store/useStore.ts`) |
| Database | Supabase (Postgres + Auth + RLS + Realtime) |
| Payments | Razorpay (subscriptions, INR) |
| AI | Anthropic Claude (Haiku for coaching, Sonnet for estimation) |
| Email | Resend |
| WhatsApp | Meta Cloud API v21.0 |
| Voice Transcription | OpenAI Whisper |
| Rate Limiting | Upstash Redis |
| Monitoring | Sentry |
| Deployment | Vercel (Hobby plan) |

---

## Architecture Overview

```
Browser (PWA)
  └─ AppShell → LandingPage | AuthScreen | OnboardingFlow | Dashboard | FocusMode
       └─ Zustand store (useStore.ts ~2000 lines — single source of truth)
            ├─ localStorage (offline fallback)
            └─ Supabase (primary, via src/lib/api.ts)

Vercel Serverless
  ├─ /api/subscription/* — Razorpay billing
  ├─ /api/whatsapp/webhook — WhatsApp bot (incoming messages)
  ├─ /api/cron/* — scheduled emails + AI coach
  ├─ /api/coach/* — AI endpoints (debrief, plan, motivation)
  ├─ /api/pacts/* — accountability partner system
  ├─ /api/admin/* — admin dashboard APIs
  └─ /api/sessions/complete — atomic session completion

External Cron (cron-job.org, hourly)
  └─ GET /api/cron/coach — evaluates nudges per user's local timezone
```

---

## Subscription Model

Two tiers via Razorpay:

| Tier | Price | Features |
|------|-------|----------|
| **Starter** | ₹499/month | Pomodoro timer, daily planner, AI estimation, streak tracking, email nudges, WhatsApp bot (reactive) |
| **Pro** | ₹999/month | Everything in Starter + proactive AI coach on WhatsApp (morning briefing, midday check, EOD summary, streak protection, weekly reflection, idle detection) |

Both tiers have a 3-day free trial. The trial is implicit (no payment method required).

**Key files:**
- `src/lib/pricing.ts` — price constants
- `src/lib/razorpay.ts` — Razorpay plan IDs and helpers
- `src/app/api/subscription/create/route.ts` — creates Razorpay subscription
- `src/app/api/subscription/status/route.ts` — reads subscription state (handles trial expiry, admin grants)
- `src/app/api/subscription/verify/route.ts` — confirms payment after Razorpay checkout
- `src/app/api/webhooks/razorpay/route.ts` — handles Razorpay webhook events

---

## Database Schema (Supabase)

Migrations are in `supabase/migrations/` (003 through 018). Key tables:

| Table | Purpose |
|-------|---------|
| `profiles` | User settings, timezone, WhatsApp phone, coaching preferences, admin flag |
| `goals` | Long-term goals with AI-estimated sessions, milestones, confidence scores |
| `sessions` | Pomodoro sessions (active/completed/discarded) linked to goals |
| `daily_tasks` | Date-scoped tasks with pomodoro targets, tags, time blocks, sort order |
| `repeating_templates` | Templates that auto-generate daily tasks each day |
| `subscriptions` | Billing state: status, plan_tier, trial/period dates, Razorpay IDs |
| `journal_entries` | One per user per day, with optional AI prompt |
| `shadow_goals` | "Someday" shelf — parked goal ideas |
| `coach_log` | Every AI coach nudge sent (dedup, cap enforcement, analytics) |
| `pacts` | Accountability partnerships between two users |
| `coupons` | Discount codes with redemption tracking |
| `email_log` | Sent email history |

**RLS:** All tables have row-level security. Service role is used by cron jobs and admin routes.

---

## WhatsApp Bot

The bot lives in `src/app/api/whatsapp/webhook/route.ts` (~900 lines). It handles:

**Reactive commands (user-initiated):**
- Add tasks: "Study React for 2 pomodoros and review PRs"
- Voice notes: send audio, transcribed via Whisper, parsed as text
- List tasks: "What's my plan?" — numbered list, reply with number to complete
- Complete task: "Done with React" or reply "2" to complete task #2
- Edit task: "Change React to 3 pomodoros" or "Rename React to Vue"
- Delete task: "Delete React"
- Check progress: "How am I doing?"
- Time today: "How long today?"
- Journal: "Add journal entry for today" (two-step: prompts, then saves next message)
- Plan tomorrow: "Plan tomorrow"
- Carry forward: "Carry all" — moves incomplete tasks to tomorrow
- Pause coaching: "Shh" — pauses AI coach for 24h
- Help: "Help"

**Proactive nudges (cron-driven, Pro tier only):**
- Morning kickoff (8 AM local) — task count, streak, goal progress
- Task planning prompt (9 AM) — fires only if no tasks added yet
- Midday check-in (1 PM) — progress update
- Streak protection (7 PM) — fires if streak ≥3 and no sessions today
- Streak saver (6 PM) — gentler version for streak ≥2
- Evening wrapup (8 PM) — day summary
- EOD summary (9 PM) — final score + "reply carry all to move tasks"
- Weekly recap (Sunday 7 PM) — week stats
- Weekly reflection (Sunday 8 PM) — asks for journal entry, saves reply

**Key files:**
- `src/lib/whatsapp.ts` — send text/button messages, download media, extract incoming messages
- `src/lib/whatsapp-ai.ts` — AI intent parser (WAIntent type)
- `src/lib/coach-engine.ts` — nudge evaluation logic (which nudge for which user at which hour)
- `src/lib/coach-ai.ts` — AI message generation per nudge type + fallback templates

---

## Cron Jobs

Vercel Hobby allows only daily crons. We supplement with an external hourly cron (cron-job.org):

| Endpoint | Vercel Schedule | External Schedule | Purpose |
|----------|----------------|-------------------|---------|
| `/api/cron/coach` | Daily 2 AM UTC | **Hourly** | AI coach nudges (timezone-aware) |
| `/api/cron/morning-email` | Daily 6 AM UTC | — | Morning email digest |
| `/api/cron/afternoon-email` | Daily 1 PM UTC | — | Afternoon email |
| `/api/cron/nightly-email` | Daily 9 PM UTC | — | Nightly email |
| `/api/cron/trial-ending` | Daily 10 AM UTC | — | Trial expiry warning emails |

**External cron setup:** Hit `/api/cron/coach` with header `Authorization: Bearer <CRON_SECRET>` every hour.

---

## Key UI Features

### Timer & Focus Mode
- Web Worker-based timer (`public/timer-worker.js`) — survives tab throttling
- Full-screen focus mode with ambient sound picker (synth + file-based)
- Screen Wake Lock API prevents laptop sleep during sessions
- Picture-in-Picture support
- Break screen shows "Break" title, next task preview, "Start Next Session" button
- Breathing meditation during breaks (Headspace-style expanding/contracting waves)

### Standalone Meditation
- Accessible via "Meditate" button in dashboard header (next to clock)
- Custom duration picker (1–20 min)
- Breathing guide animation with countdown timer

### Daily Grind Mode
- Date-navigable task planner with list and schedule (time block) views
- AI-powered "Plan My Day" wizard
- "Plan Tomorrow" modal — carry forward incomplete tasks + add new ones
- Per-task pomodoro tracking
- Repeating task templates

### Session Counting Fix
- Daily tasks show per-task pomodoro counts (e.g., "Pomodoro 2 of 4")
- Long-term goals show per-goal session counts (e.g., "Session 12 of 180")
- The two never cross-contaminate

### Personalized Daily Brief
- Shows on dashboard load: streak, pending tasks, goal pace, AI one-liner
- Dismissible per session (sessionStorage)

### Accountability Pacts
- Invite a friend by email → they get an invite code
- Both see each other's streak and weekly activity
- UI in Settings modal

### Offline Resilience
- IndexedDB queue stores failed API calls (session complete, task updates)
- Replays automatically when connectivity returns
- Initialized on app load via `src/lib/offline-queue.ts`

### Quick Pomodoro (Friction-free Onboarding)
- "Try a quick pomodoro" CTA on landing page — no signup required
- Creates guest user/goal state, launches focus mode
- After completion: signup prompt with "Create free account" or "Maybe later"

---

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Site
NEXT_PUBLIC_SITE_URL=https://effortos-zeta.vercel.app

# Razorpay
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
NEXT_PUBLIC_RAZORPAY_KEY_ID=
RAZORPAY_PLAN_ID=              # Starter plan
RAZORPAY_PRO_PLAN_ID=          # Pro plan (create via scripts/create-pro-plan.js)
RAZORPAY_WEBHOOK_SECRET=
NEXT_PUBLIC_STARTER_PRICE=499
NEXT_PUBLIC_PRO_PRICE=999

# AI
ANTHROPIC_API_KEY=              # Claude (coaching, estimation, debrief)
OPENAI_API_KEY=                 # Whisper (voice note transcription)

# Email
RESEND_API_KEY=
RESEND_SENDER=

# WhatsApp
WHATSAPP_TOKEN=                 # Meta system user token
WHATSAPP_PHONE_ID=              # Phone Number ID
WHATSAPP_VERIFY_TOKEN=          # Webhook verification secret
META_APP_SECRET=                # Webhook signature verification

# Cron
CRON_SECRET=                    # Shared secret for cron endpoint auth

# Rate limiting
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Monitoring
SENTRY_DSN=
```

---

## Admin Dashboard

Accessible at `/admin` (requires `is_admin: true` on profile).

**Pages:**
- `/admin` — Overview: user count, trial/paid/pro counts, coach nudges sent
- `/admin/users` — User management: extend trials, grant premium (starter/pro), toggle admin
- `/admin/metrics` — Tier-split MRR, signups, DAU, conversion rate, coach stats
- `/admin/coupons` — Create/manage discount codes
- `/admin/content` — Edit landing page copy
- `/admin/email` — Send emails, view log

---

## Development

```bash
# Install
npm install --force

# Dev server
npm run dev

# Type check
npx tsc --noEmit

# Deploy
git push origin main  # Vercel auto-deploys
```

### File Organization
```
src/
  app/
    api/          — API routes (serverless functions)
    admin/        — Admin dashboard pages
  components/
    dashboard/    — Dashboard views, modals, cards
    timer/        — Focus mode, meditation, ambient sound
    subscription/ — Paywall, trial banner, premium gate
    auth/         — Auth screen
    onboarding/   — Goal creation wizard
    layout/       — AppShell, LandingPage
    ui/           — Shared UI primitives
  hooks/          — useTimer, useWakeLock, useServiceWorker, useRealtimeSync
  lib/            — Business logic, API client, storage, sounds, offline queue
  store/          — Zustand store (useStore.ts)
  types/          — TypeScript types
public/
  timer-worker.js — Web Worker for reliable background timing
  sw.js           — Service Worker for PWA/offline
  sounds/         — Audio files (optional, synth fallback exists)
supabase/
  migrations/     — SQL migrations (003–018)
scripts/
  create-pro-plan.js — Creates Razorpay Pro plan via API
```

### The Store (`src/store/useStore.ts`)
This is the most important file (~2000 lines). It's a single Zustand store that manages all client state: auth, goals, timer, daily tasks, subscription, coaching, UI modals, and more. Key patterns:
- `cloudSync()` — fire-and-forget Supabase writes with optional offline fallback
- `initializeApp()` — tries Supabase first, falls back to localStorage
- Timer actions: `startTimer`, `pauseTimer`, `resumeTimer`, `completeTimerSession`, `skipBreak`
- `startQuickPomodoro()` — creates guest state for friction-free onboarding
- `isProTier()` — checks subscription status + plan_tier
- `fetchSubscriptionStatus()` — called on init + window focus + every 5 min

---

## Known Patterns & Gotchas

1. **Subscription refresh**: The client re-fetches subscription status on window focus and every 5 minutes. This catches admin-granted upgrades without requiring a page reload.

2. **Timezone handling**: All date-scoped operations (daily tasks, coach nudges, streaks) use the user's timezone stored in `profiles.timezone`. Helper functions in `src/lib/user-date.ts`.

3. **WhatsApp multi-step flows**: Some commands (journal entry, weekly reflection) require two messages. The webhook uses an in-memory `pendingFlowMap` with 10-minute TTL. For cross-invocation state (weekly reflection), it checks `coach_log` for recent prompts.

4. **Numbered task replies**: When the bot sends a task list, it stores the task ID order in `taskListMap` (30-min TTL). User replies "2" → completes the second task.

5. **Voice notes**: WhatsApp sends audio as a media ID. The webhook downloads it via Meta's API, sends to OpenAI Whisper for transcription, then feeds the transcript through the normal AI intent parser.

6. **Ambient sound**: Auto-pauses during breaks, auto-resumes when focus starts. Uses custom events (`ambient-sound-pause/resume`) dispatched from `useTimer` and handled in `AmbientSoundToggle`.

7. **Web Worker timer**: The timer runs in a Web Worker (`public/timer-worker.js`) so it isn't throttled when the tab is in the background. Falls back to `setInterval` if Workers aren't available.

8. **Offline queue**: Failed API calls are stored in IndexedDB and replayed when connectivity returns. Critical paths (session complete, task update) have offline fallbacks configured in `cloudSync()`.

---

*Last updated: April 2026*
