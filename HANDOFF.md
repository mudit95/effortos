# EffortOS — Developer Handoff Document

## What is EffortOS?

EffortOS is an AI-powered productivity app built around the Pomodoro technique. Users set long-term goals, AI estimates the focused-session count required, daily tasks roll up under those goals, and a proactive WhatsApp coach keeps Pro users on track. It runs as a Next.js PWA deployed on Vercel (Hobby plan), with Supabase as backend and GitHub Actions for cron.

**Live URL:** https://effortos-zeta.vercel.app
**Status:** Launch-ready as of April 2026. ~65 launch fixes shipped across migrations 022–030. Currently smoke-testing on the `effortos-zeta.vercel.app` domain ahead of cutting over to a custom domain.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| UI | React 19, Tailwind CSS 4, Framer Motion, Lucide icons |
| State | Zustand (single store: `src/store/useStore.ts`) |
| Database | Supabase (Postgres + Auth + RLS + Realtime) |
| Payments | Razorpay (subscriptions, INR) |
| AI | Anthropic Claude (Haiku for coaching, Sonnet for estimation), Groq for fast paths |
| Email | Resend (bounce/complaint webhook wired) |
| WhatsApp | Meta Cloud API v21.0 |
| Voice Transcription | OpenAI Whisper |
| Bot protection | Cloudflare Turnstile + honeypot |
| Rate Limiting | Upstash Redis |
| Monitoring | Sentry (with PII scrubber, consent-gated init) |
| Deployment | Vercel Hobby + GitHub Actions for cron |

---

## Architecture Overview

```
Browser (PWA)
  └─ AppShell → LandingPage | AuthScreen | OnboardingFlow | Dashboard | FocusMode
       └─ Zustand store (useStore.ts ~2300 lines — single source of truth)
            ├─ localStorage (offline fallback)
            ├─ IndexedDB queue (failed API calls, replays on reconnect)
            └─ Supabase (primary, via src/lib/api.ts)

Vercel Serverless (Hobby — 60s function ceiling)
  ├─ /api/subscription/* — Razorpay billing (two-phase webhook: received → processed)
  ├─ /api/whatsapp/webhook — WhatsApp bot (msg-ID dedup, voice cap, Pro tier gate)
  ├─ /api/cron/* — 11 cron endpoints (see Cron Jobs)
  ├─ /api/coach/* — AI endpoints (debrief, plan, motivation) — quota-wrapped
  ├─ /api/pacts/* — accountability partner system
  ├─ /api/admin/* — admin dashboard (audit-logged)
  ├─ /api/sessions/complete — idempotent session completion
  ├─ /api/account/{export,delete} — GDPR endpoints (30-day soft-delete + purge)
  ├─ /api/unsubscribe — HMAC-signed token, used by all transactional emails
  └─ /api/webhooks/{razorpay,resend} — payment + bounce/complaint events

GitHub Actions cron (.github/workflows/cron.yml)
  └─ Hourly fan: morning-email, afternoon-email, nightly-email, coach
  └─ Watchdog: hourly +15 (detects stale cron runs)
  └─ Daily: pacts-cleanup, retention-sweep, purge-deleted-accounts,
            re-engagement, pact-activity, trial-ending
```

The cron schedules live in GitHub Actions rather than `vercel.json` because the Hobby plan caps cron frequency. The repo's CI permissions are enough — no third-party scheduler involved.

---

## Subscription Model

Two tiers via Razorpay, both with a 3-day free trial (no payment method required).

| Tier | Price | Features |
|------|-------|----------|
| **Starter** | ₹499/month | Pomodoro timer, daily planner, AI estimation, streak tracking, email nudges, reactive WhatsApp bot |
| **Pro** | ₹999/month | Everything in Starter + proactive AI coach on WhatsApp (morning brief, midday check, EOD summary, streak protection, weekly reflection, idle detection) |

Past-due subscriptions get a 7-day grace window in `PremiumGate` and `requireActiveSub` so a single failed renewal doesn't lock users out instantly. UI cue surfaces in `SettingsModal`.

**Key files:**
- `src/lib/pricing.ts` — price constants (used by both client and server; no hardcoded prices anywhere else)
- `src/lib/razorpay.ts` — Razorpay plan IDs and helpers
- `src/app/api/subscription/create/route.ts` — creates Razorpay subscription (uses service-role client after RLS hardening migration 022)
- `src/app/api/subscription/status/route.ts` — reads subscription state, handles trial expiry + admin grants + grace window
- `src/app/api/subscription/verify/route.ts` — confirms payment after Razorpay checkout, never trusts client-supplied `plan_tier`
- `src/app/api/webhooks/razorpay/route.ts` — two-phase webhook: status `received` → `processed`. Idempotent on retries.

---

## Database Schema (Supabase)

30 migrations in `supabase/migrations/`. Migrations 003–021 were originally applied via the Supabase dashboard SQL editor; 022–030 were applied via dashboard as well because the CLI's `supabase_migrations.schema_migrations` table didn't have records for the earlier ones. Going forward, prefer dashboard SQL editor unless you reset migration tracking.

| Table | Purpose |
|-------|---------|
| `profiles` | User settings, timezone, WhatsApp phone, coaching prefs, admin flag, `deleted_at` (soft-delete) |
| `goals` | Long-term goals with AI-estimated sessions, milestones, confidence scores |
| `sessions` | Pomodoro sessions (active/completed/discarded) — idempotent completion endpoint |
| `daily_tasks` | Date-scoped tasks with pomodoro targets, tags, time blocks, sort order |
| `repeating_templates` | Templates that auto-generate daily tasks each day |
| `subscriptions` | Billing state: status, plan_tier, trial/period dates, Razorpay IDs |
| `journal_entries` | One per user per day, optional AI prompt, `UNIQUE(user_id, date)` |
| `shadow_goals` | "Someday" shelf — parked goal ideas |
| `coach_log` | Every AI coach nudge sent. **UNIQUE per `(user_id, nudge_type, day-UTC)`** (mig 025) — atomic claim prevents duplicate nudges on cron retries |
| `pacts` + `pact_user_stats` view | Accountability partnerships (RLS-hardened in 022) |
| `coupons` | Discount codes; `redeem_coupon_atomic` RPC enforces redemption count |
| `email_log` | Sent email history (used for re-engagement cooldown logic) |
| `email_preferences` | `unsubscribed_all` flag toggled by /api/unsubscribe + Resend bounce webhook |
| `wa_processed_messages` (mig 024) | Message-ID dedup for WhatsApp webhook |
| `webhook_events` | Razorpay webhook idempotency + status tracking (mig 023) |
| `admin_audit` (mig 026) | Every admin action logged via `audit-insert` helper |
| `consent_log` (mig 027) | Cookie consent records (gates Sentry init) |
| `cron_run_log` (mig 030) | Every cron run records start/end + status — watchdog reads this to detect stale runs |
| `daily_anthropic_usage` | Per-user daily token cap (used by all AI endpoints) |
| Data-cap triggers (mig 029) | BEFORE INSERT triggers cap goals, daily_tasks/day, sessions/day per user |

**RLS:** All tables have row-level security. Service role used by cron jobs and admin routes. Migration 022 closed RLS holes on subscriptions, coach_log, pact_user_stats view, and `redeem_coupon_atomic`.

---

## Security & Compliance

**Implemented as of April 2026:**

- Security headers: CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy
- Cloudflare Turnstile + honeypot on signup
- HMAC-signed unsubscribe tokens (`src/lib/unsubscribe-token.ts`) — every transactional email's `List-Unsubscribe` and footer link uses these
- Resend bounce/complaint webhook (Svix-signed) flips `email_preferences.unsubscribed_all`
- Account export (`/api/account/export`) covers all 14 user-owned tables
- Account deletion is soft (sets `deleted_at`); `purge-deleted-accounts` cron hard-deletes after 30 days. Privacy policy promises "we delete within 30 days"
- Cookie consent banner gates Sentry init; Sentry has PII scrubber on all 3 configs (browser/edge/node)
- Per-user daily Anthropic token cap (default 50k) — enforced by `withAnthropicQuota` wrapper on all coach AI routes + `generateChatResponse`
- Per-user data caps via Postgres BEFORE INSERT triggers (max goals, daily_tasks/day, sessions/day)
- Open-redirect fix in `/auth/callback` (whitelisted `next` param)
- WhatsApp parser uses prompt-injection delimiters and validates payload shape
- Cron-auth bearer comparison is timing-safe
- Admin audit log captures every admin action

**Outstanding for production cutover:**
- Custom domain + Resend domain verification
- Razorpay live-mode KYC content (registered office address + GST/SAC on contact page)
- WhatsApp Cloud API templates approval with Meta (operational requirement for Pro proactive nudges)

---

## WhatsApp Bot

The bot lives in `src/app/api/whatsapp/webhook/route.ts` (~900 lines). Hardened paths: message-ID dedup via `wa_processed_messages` (mig 024), fast 200 ACK to Meta, voice-note size cap, Pro-tier gate on premium features.

**Reactive commands (user-initiated):**
- Add tasks: "Study React for 2 pomodoros and review PRs"
- Voice notes: send audio, transcribed via Whisper, parsed as text (size-capped, language-detected)
- List tasks: "What's my plan?" — numbered list
- Complete: "Done with React" or reply "2"
- Edit: "Change React to 3 pomodoros" or "Rename React to Vue"
- Delete: "Delete React"
- Progress: "How am I doing?"
- Time today: "How long today?"
- Journal: "Add journal entry for today" (two-step)
- Plan tomorrow: "Plan tomorrow"
- Carry forward: "Carry all"
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
- `src/lib/coach-engine.ts` — nudge evaluation logic
- `src/lib/coach-ai.ts` — AI message generation per nudge type + fallback templates. Respects `bot_persona` field (mig 020) — also propagated to email-companion nudges

---

## Cron Jobs

11 endpoints fanned out by `.github/workflows/cron.yml`. Each cron records its run in `cron_run_log` (mig 030); the `watchdog` cron reads that log to detect stale runs and alerts.

| Endpoint | Schedule | Purpose |
|----------|----------|---------|
| `coach` | Hourly | AI coach nudges (timezone-aware, atomic-claim via mig 025 unique index) |
| `morning-email` | Hourly | Morning email digest (filters by user's local hour) |
| `afternoon-email` | Hourly | Afternoon email |
| `nightly-email` | Hourly | Nightly email |
| `watchdog` | Hourly +15 | Reads `cron_run_log`, alerts on stale runs |
| `pacts-cleanup` | Daily 03:00 UTC | Removes expired pact invites |
| `retention-sweep` | Daily 04:00 UTC | Trims `coach_log`, `email_log`, `wa_processed_messages`, `webhook_events` to retention windows |
| `purge-deleted-accounts` | Daily 04:30 UTC | Hard-deletes profiles where `deleted_at` > 30d |
| `re-engagement` | Daily 06:00 UTC | Emails users with no session in 14d (30-day cooldown via `email_log`) |
| `pact-activity` | Daily 07:30 UTC | Notifies pact partners of yesterday's activity |
| `trial-ending` | Daily 08:30 UTC | Emails users with trials expiring in 24h |

All endpoints use `verifyCronAuth(request)` with timing-safe bearer compare. Concurrency is bounded with `concurrentMap` (replaces an earlier serial loop that timed out at scale). `maxDuration` is 60s on every endpoint (Hobby ceiling).

**Required GitHub repo secrets:**
- `CRON_SECRET` — same value as the Vercel `CRON_SECRET` env var
- `SITE_URL` — e.g. `https://effortos-zeta.vercel.app` (no trailing slash)

The workflow also exposes `workflow_dispatch` with a cron-name dropdown for manual firing from the Actions UI.

---

## Key UI Features

### Daily Grind — three-lens task planner
A single date-navigable task list rendered through three layouts the user can switch between. Last-used layout persists per device via `storage.setDailyGrindLayout`.

- **List** (default): classic ordered task list with pomodoro counters
- **Schedule** (`TimeBoxView`): drag-and-drop time blocks (morning / afternoon / evening / unscheduled)
- **Flow** (`FlowView`): two-column split — pending tasks with active task pinned on the left, completed-pomodoros ledger on the right

The shared `TaskRow` component (exported from `DailyGrind.tsx`) is used across List and Flow so the active-task ring, tag pills, +1, roll-forward, and delete behave identically. `title` attributes on truncated text give a hover tooltip in narrow Flow columns.

### Timer & Focus Mode
- Web Worker-based timer (`public/timer-worker.js`) — survives tab throttling
- Timestamp-based recompute on tick (no setInterval drift)
- Full-screen `FocusMode` component with circular ring, ambient sound picker, breathing meditation overlay, PiP, keyboard shortcuts (Space, Esc, P, ?), Wake Lock, multi-device timer banner
- iOS Safari has a synth fallback for music-tier ambient sounds

### Standalone Meditation
- Accessible from dashboard header
- Custom duration picker (1–20 min), breathing-guide animation

### AI Plan Wizard + Plan Tomorrow
- "Plan My Day with AI" generates a tagged, pomodoro-budgeted task list
- "Plan Tomorrow" carries forward incomplete tasks + lets user add new ones

### Personalized Daily Brief
- Streak, pending tasks, goal pace, AI one-liner
- Dismissible per session

### Accountability Pacts
- Invite a friend by email → invite code
- Both see each other's streak and weekly activity
- Nightly `pact-activity` cron sends partner-summary emails

### Offline Resilience
- IndexedDB queue stores failed API calls (session complete, task updates)
- Replays automatically when connectivity returns
- Service worker bypasses `/api/*` so dynamic routes never get stale-cached

### Quick Pomodoro (friction-free onboarding)
- "Try a quick pomodoro" CTA on landing page — no signup
- Creates guest user/goal state, launches focus mode
- Post-completion: signup prompt with "Create free account" / "Maybe later"

### Skeleton states
Dashboard renders skeleton layouts while data loads — perceived perf bumped meaningfully (user feedback: "the website appears much smoother now").

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
RAZORPAY_PLAN_ID=                 # Starter plan
RAZORPAY_PRO_PLAN_ID=             # Pro plan (create via scripts/create-pro-plan.js)
RAZORPAY_WEBHOOK_SECRET=
NEXT_PUBLIC_STARTER_PRICE=499
NEXT_PUBLIC_PRO_PRICE=999

# AI
ANTHROPIC_API_KEY=                # Claude (coaching, estimation, debrief)
GROQ_API_KEY=                     # Fast paths
OPENAI_API_KEY=                   # Whisper (voice note transcription)

# Email
RESEND_API_KEY=
RESEND_SENDER=
RESEND_WEBHOOK_SECRET=            # Svix signature on bounce/complaint webhook
UNSUBSCRIBE_SECRET=               # HMAC key for /api/unsubscribe tokens

# WhatsApp
WHATSAPP_TOKEN=                   # Meta system user token
WHATSAPP_PHONE_ID=                # Phone Number ID
WHATSAPP_VERIFY_TOKEN=            # Webhook verification secret
META_APP_SECRET=                  # Webhook signature verification

# Cron + bot protection
CRON_SECRET=                      # Shared secret for cron endpoint auth (mirrored in GH Actions secrets)
TURNSTILE_SECRET_KEY=             # Cloudflare Turnstile (server)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=   # Cloudflare Turnstile (client)

# Rate limiting
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Monitoring + analytics
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_POSTHOG_KEY=          # Optional — analytics shim no-ops if unset
NEXT_PUBLIC_POSTHOG_HOST=
```

The unsubscribe-token helper has a dev fallback so tests don't require `UNSUBSCRIBE_SECRET` to be set; in production the env var is mandatory.

---

## Admin Dashboard

`/admin` (requires `is_admin: true` on profile). Every action is captured in `admin_audit` via the `audit-insert` helper.

- `/admin` — Overview: user count, trial/paid/pro counts, coach nudges sent
- `/admin/users` — User management: extend trials, grant premium, toggle admin
- `/admin/metrics` — Tier-split MRR, signups, DAU, conversion, coach stats
- `/admin/coupons` — Create/manage discount codes
- `/admin/content` — Edit landing page copy
- `/admin/email` — Send emails, view log
- `/admin/audit` — Read the audit log

---

## Development

```bash
# Install
npm install --force

# Dev server
npm run dev

# Type check
npx tsc --noEmit

# Lint
npx eslint src/

# Tests
npx vitest run

# Deploy
git push origin main          # Vercel auto-deploys main
```

CI (`.github/workflows/ci.yml`) runs typecheck + lint + Vitest on every PR.

### File Organization
```
src/
  app/
    api/          — API routes (serverless functions)
    admin/        — Admin dashboard pages
  components/
    dashboard/    — Dashboard views, modals, cards
                  — DailyGrind has 3 lenses: List (inline), TimeBoxView (Schedule), FlowView (Plan vs Done)
    timer/        — FocusMode, BreathingGuide, AmbientSoundToggle, PiPButton
    subscription/ — Paywall, trial banner, premium gate
    auth/         — AuthScreen
    onboarding/   — Goal creation wizard (with Turnstile)
    layout/       — AppShell, LandingPage
    ui/           — Shared UI primitives + cookie consent
  hooks/          — useTimer, useWakeLock, useServiceWorker, useRealtimeSync, usePiP
  lib/            — Business logic, API client, storage, cron-helpers, anthropic-quota,
                    audit-insert, account-deletion, unsubscribe-token, coach-engine
  store/          — Zustand store (useStore.ts)
  types/          — TypeScript types
  test/           — Vitest setup + mocks
public/
  timer-worker.js — Web Worker for reliable background timing
  sw.js           — Service Worker for PWA/offline (bypasses /api/*)
supabase/
  migrations/     — SQL migrations 003–030
.github/workflows/
  cron.yml        — All 11 crons (replaces Vercel cron on Hobby)
  ci.yml          — typecheck + lint + test on PR
scripts/
  create-pro-plan.js — Creates Razorpay Pro plan via API
tests/
  api/            — Route tests (subscription, sessions, razorpay-webhook)
  lib/            — Library tests (email, etc.)
```

### The Store (`src/store/useStore.ts`)
~2300 lines, single Zustand store. Selectors are split per-field (`useStore(s => s.dailyTasks)` etc.) to avoid full-store re-renders when `timeRemaining` ticks. Key patterns:
- `cloudSync()` — fire-and-forget Supabase writes with offline fallback to IndexedDB queue
- `initializeApp()` — tries Supabase first, falls back to localStorage. `_initPromise` race window is hardened.
- Timer actions: `startTimer`, `pauseTimer`, `resumeTimer`, `completeTimerSession`, `skipBreak`
- `startQuickPomodoro()` — creates guest state for friction-free onboarding
- `isProTier()` — checks subscription status + plan_tier
- `fetchSubscriptionStatus()` — called on init + window focus + every 5 min

---

## Known Patterns & Gotchas

1. **Subscription refresh:** client re-fetches subscription status on window focus and every 5 minutes. Catches admin-granted upgrades without a reload.

2. **Past_due grace:** 7-day grace window in `PremiumGate` and `requireActiveSub` — single failed renewal doesn't lock users out. UI cue in `SettingsModal`.

3. **Timezone handling:** all date-scoped operations (daily tasks, coach nudges, streaks, reports) use the user's `profiles.timezone`. Helper functions in `src/lib/user-date.ts`. Reports range used to be UTC; fixed in fix #37.

4. **WhatsApp multi-step flows:** journal entry, weekly reflection require two messages. Webhook uses `pendingFlowMap` (10-min TTL). For cross-invocation state (weekly reflection), checks `coach_log` for recent prompts.

5. **Numbered task replies:** bot stores task ID order in `taskListMap` (30-min TTL). User replies "2" → completes task #2.

6. **Voice notes:** WhatsApp sends audio as media ID. Webhook downloads via Meta API, sends to Whisper, feeds transcript through AI intent parser. Size-capped; language-detected.

7. **Ambient sound:** auto-pauses during breaks, auto-resumes when focus starts. Custom events (`ambient-sound-pause/resume`) dispatched from `useTimer`.

8. **Web Worker timer:** runs in a Web Worker so it isn't throttled when the tab is backgrounded. Falls back to `setInterval` if Workers aren't available, with timestamp-based recompute (no drift).

9. **Offline queue:** failed API calls stored in IndexedDB, replayed on reconnect. Critical paths (session complete, task update) have offline fallbacks in `cloudSync()`.

10. **Idempotent session complete:** `/api/sessions/complete` is idempotent — duplicate POSTs (e.g. from offline-queue replay) return the existing session without double-incrementing.

11. **Atomic coach claim:** `coach_log` has a unique partial index on `(user_id, nudge_type, day-UTC)`. The cron inserts the row BEFORE sending to claim; if a concurrent retry hits 23505, it skips the send.

12. **Goal ID divergence:** local goals use `crypto.randomUUID()`; cloud goals use Supabase-assigned UUIDs. Reconciliation logic in `useStore.initializeApp()` matches by `created_at` + title to avoid duplicates.

13. **Razorpay webhook idempotency:** two-phase pattern — `received` insert first (UNIQUE on event_id), then `processed` update. Retries see status='received' or 'processed' and short-circuit.

14. **Service-role vs auth-bound clients:** anything that bypasses RLS (cron, webhooks, account deletion) uses `createServiceClient()`. Tests must mock both `@/lib/supabase/service` AND the per-request auth-bound client.

15. **Anthropic quota:** every AI endpoint goes through `withAnthropicQuota(userId, fn)` which checks `daily_anthropic_usage` and 429s when exhausted. Default 50k tokens/user/day.

16. **Skeleton vs spinner:** prefer skeleton states for dashboard panels — perceived perf wins were significant.

17. **Migration tracking:** because mig 003–021 were applied via dashboard SQL editor (not CLI), `supabase db push` will fail with "policy already exists" errors. Apply 022+ via dashboard until the migration tracking is reset.

---

## What's left before public launch

**Required for production cutover:**
- Custom domain + Resend domain verification (then update `NEXT_PUBLIC_SITE_URL` and Razorpay webhook URL)
- Razorpay live-mode KYC: registered office address + GST/SAC on contact page
- WhatsApp Cloud API templates submitted + approved with Meta (Pro proactive nudges depend on approved templates)

**Nice-to-have / deferred:**
- TWA / Android app on Play Store (3–5 days work)
- PostHog API key paste-in to activate analytics (shim already in place, no-ops without key)
- Pricing decision (currently ₹499/₹999, locked for now)

---

*Last updated: April 30, 2026*
