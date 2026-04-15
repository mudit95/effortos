# EffortOS — Claude Session Handoff

Use this document as your first-message context when starting a new Claude session for this project. Select the `effortos` folder so Claude has file access, then paste this entire document.

---

## Project Overview

**EffortOS** is a production-grade AI-powered adaptive effort tracking system with Pomodoro timer.

**Live URL:** https://effortos-zeta.vercel.app
**Admin panel:** https://effortos-zeta.vercel.app/admin

### Tech Stack
- **Framework:** Next.js 16.2.2 (App Router, Turbopack), React 19, TypeScript
- **Database/Auth:** Supabase (with RLS policies, `SECURITY DEFINER` `check_is_admin()` function)
- **State:** Zustand (store-first pattern) — `src/store/useStore.ts`
- **Payments:** Razorpay subscriptions (₹499/month INR, 3-day free trial)
- **Email:** Resend (transactional email via API)
- **Hosting:** Vercel (with cron jobs for scheduled emails)
- **AI:** Anthropic Claude SDK for coaching features
- **UI:** Tailwind CSS 4, Framer Motion, Lucide React icons, Radix UI primitives
- **Charts:** Recharts

### Key Architecture Patterns
- `@supabase/ssr` for server/client Supabase clients
- RLS policies with `check_is_admin(auth.uid())` using `SECURITY DEFINER` to avoid recursion
- `PremiumGate` component for client-side feature gating (blur + paywall overlay)
- `requireActiveSub()` server-side guard for API route protection
- HMAC-SHA256 webhook signature verification with `crypto.timingSafeEqual`
- Event idempotency via `webhook_events` table
- Timezone-aware email delivery: crons run hourly, filter users by local hour

---

## Directory Structure

```
src/
├── app/
│   ├── api/
│   │   ├── admin/          # Admin endpoints (content, coupons, email, users)
│   │   ├── coach/          # AI endpoints (insight, motivation, plan-day, session-debrief, weekly-insight)
│   │   ├── cron/           # Scheduled email jobs (morning, afternoon, nightly)
│   │   ├── daily-tasks/    # Task CRUD
│   │   ├── email-preferences/
│   │   ├── reports/        # Analytics
│   │   ├── sessions/       # Pomodoro session management
│   │   ├── subscription/   # create, status, cancel
│   │   └── webhooks/razorpay/  # Webhook handler
│   ├── admin/              # Admin UI (overview, users, coupons, metrics, content, email)
│   ├── dashboard/          # Main app dashboard
│   ├── focus/              # Focus/timer view
│   └── onboarding/         # New user flow
├── components/
│   ├── dashboard/          # Dashboard.tsx, SettingsModal.tsx, DailyGrind, Reports, etc.
│   ├── subscription/       # TrialBanner.tsx, PremiumGate.tsx, PaywallModal.tsx
│   └── timer/              # Timer components
├── lib/
│   ├── supabase/           # client.ts, server.ts
│   ├── email.ts            # Resend wrapper + emailLayout()
│   ├── email-templates.ts  # Morning/afternoon/nightly/admin-custom templates
│   ├── cron-auth.ts        # Bearer token verification for cron endpoints
│   ├── cron-helpers.ts     # getEligibleUsers(), getUserTasks(), etc.
│   ├── pricing.ts          # DISPLAY_PRICE, DISPLAY_PRICE_PER_MONTH constants
│   ├── razorpay.ts         # MONTHLY_PRICE, CURRENCY
│   └── subscription-guard.ts  # requireActiveSub() server-side guard
├── store/useStore.ts       # Zustand store (1400+ lines, all app state)
└── types/index.ts          # All TypeScript types
```

### Supabase Migrations (in `supabase/migrations/`)
- `003_subscriptions.sql` — Subscription table
- `004_admin_dashboard.sql` — Admin metrics tables
- `005_coupon_razorpay_offer.sql` — Coupon system
- `006_subscriptions_dedup.sql` — Dedup + UNIQUE(user_id) constraint
- `007_webhook_hardening.sql` — past_due status + webhook_events table
- `008_email_infrastructure.sql` — email_preferences + email_log tables
- `009_profiles_timezone.sql` — Timezone column on profiles

All migrations 003-009 have been run in production.

---

## Environment Variables

### Vercel (Production)
```
NEXT_PUBLIC_SUPABASE_URL=https://muqavvntwzwzbxuxefre.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=(set in Vercel)
SUPABASE_SERVICE_ROLE_KEY=(set in Vercel)
RAZORPAY_KEY_ID=(set in Vercel)
RAZORPAY_KEY_SECRET=(set in Vercel)
RAZORPAY_PLAN_ID=(set in Vercel)
RAZORPAY_WEBHOOK_SECRET=(set in Vercel)
RAZORPAY_CURRENCY=INR
ANTHROPIC_API_KEY=(set in Vercel)
RESEND_API_KEY=(set in Vercel)
CRON_SECRET=(set in Vercel)
EMAIL_FROM=EffortOS <onboarding@resend.dev>  # Change once custom domain verified in Resend
NEXT_PUBLIC_SITE_URL=https://effortos-zeta.vercel.app
```

### Cron Jobs (vercel.json)
All three email endpoints run hourly (`0 * * * *`):
- `/api/cron/morning-email` (target hour: 8 AM user-local)
- `/api/cron/afternoon-email` (target hour: 2 PM user-local)
- `/api/cron/nightly-email` (target hour: 9 PM user-local)

---

## ACTIVE BUG — Fix First

**Issue:** Trial banner shows "Trial ends in 0h — tap to subscribe" even though:
- Admin extended trial to Apr 21, 2026
- Admin granted premium (period ends May 14, 2026)
- Status in DB is "trialing"

**Root cause:** The `/api/subscription/status` endpoint (file: `src/app/api/subscription/status/route.ts`) does NOT check whether `current_period_end` is in the future for active/premium users. The `TrialBanner.tsx` component only looks at `subscription.status === 'trialing'` and `trial_ends_at`, but doesn't account for premium status taking precedence.

**The bug has two parts:**

1. **`/api/subscription/status/route.ts` (line ~48-66):** When status is `trialing` and `trial_ends_at` is in the past, it checks `razorpay_payment_id` to decide expired vs active. But when admin manually extends trial, `trial_ends_at` might be updated without the status logic accounting for `current_period_end`. The endpoint should check: if `current_period_end` is in the future → status should be `active` regardless.

2. **`TrialBanner.tsx`:** The banner shows for ALL `trialing` users. It should be hidden when `subscription.status === 'active'` or when `current_period_end` is in the future (indicating premium is active). Premium should take complete precedence — no trial banner for paying users.

**Fix approach:**
- In the status endpoint: add logic so that if `current_period_end` exists and is in the future, return `status: 'active'` (premium takes precedence over trialing)
- In TrialBanner: already filters on `status !== 'trialing'` returning null, so fixing the status endpoint should cascade the fix
- Also ensure `PremiumGate.tsx` considers `past_due` as active (grace period for failed payments)

**Files to modify:**
- `src/app/api/subscription/status/route.ts` — Add premium precedence logic
- Possibly `src/components/subscription/TrialBanner.tsx` — May need no changes if status endpoint is fixed
- Possibly `src/components/subscription/PremiumGate.tsx` — Consider adding `past_due` as active

---

## Feature Gating (Already Implemented)

**Free users can:** Start a Pomodoro session (timer is ungated)

**Everything else is gated** (blurred with "Subscribe to continue" overlay):
- Daily Planner (DailyGrind)
- Reports & Analytics
- Streak Calendar
- AI Insights
- AI Motivation

**Client-side:** `PremiumGate` component wraps gated sections in `Dashboard.tsx`
**Server-side:** `requireActiveSub()` guard on all AI API routes (`/api/coach/*`)

---

## Pending Work (Priority Order)

### High Priority
1. **Fix trial/premium banner bug** (see ACTIVE BUG above)
2. **Razorpay end-to-end payment test** — Verify the full flow: subscribe → trial → charge → webhook → active status
3. **Verify Razorpay Plan exists at ₹499/month** in Razorpay dashboard
4. **Buy domain on GoDaddy** → connect to Vercel → update all URLs
5. **Verify Resend domain** once custom domain is purchased (add DNS records)
6. **Update EMAIL_FROM** env var once domain is verified in Resend

### Medium Priority
7. **Transactional emails:** Welcome email, payment-failed, trial-ending (3 new templates)
8. **Account deletion + data export** (legal requirement for production)
9. **Rate limiting on AI endpoints** (prevent abuse of Anthropic API calls)
10. **Sentry error tracking** setup

### Nice to Have (Stickiness Features Discussed)
- Morning push notifications (Web Push API for browsers)
- Streak freezes (protect streaks during off days)
- Weekly recap email with charts
- Social proof / leaderboard
- Daily planning prompt on first visit

---

## Subscription Architecture

### Flow
1. User signs up → implicit 3-day trial (no subscription row needed)
2. User clicks subscribe → Razorpay checkout opens → `subscription.authenticated` webhook
3. Trial starts → `subscription.activated` → DB row created with `trialing` status
4. Trial ends → Razorpay auto-charges → `subscription.charged` webhook → status becomes `active`
5. Payment fails → `subscription.halted` → status becomes `past_due` (grace period)
6. User cancels → `subscription.cancelled` → status becomes `cancelled`

### Status Priority (should be)
`active` (premium) > `trialing` > `past_due` > `cancelled` > `expired` > `none`

### Key Files
- `src/app/api/subscription/create/route.ts` — Creates Razorpay subscription
- `src/app/api/subscription/status/route.ts` — Returns current status (BUG HERE)
- `src/app/api/webhooks/razorpay/route.ts` — Handles all Razorpay events
- `src/lib/subscription-guard.ts` — Server-side `requireActiveSub()`
- `src/components/subscription/PremiumGate.tsx` — Client-side gate
- `src/components/subscription/TrialBanner.tsx` — Trial countdown banner
- `src/components/subscription/PaywallModal.tsx` — Subscribe modal

---

## Email System

### Architecture
- **Resend** for sending (API key in env vars)
- **Vercel Cron** runs all 3 email jobs hourly
- Each cron filters users whose **local timezone hour** matches the target hour
- `email_preferences` table controls per-user opt-in/out
- `email_log` table tracks every send for admin visibility
- Admin can compose custom emails to individuals or groups (by subscription status)

### Key Files
- `src/lib/email.ts` — Resend client, `sendEmail()`, `emailLayout()`
- `src/lib/email-templates.ts` — All 4 templates (morning, afternoon, nightly, admin custom)
- `src/lib/cron-helpers.ts` — `getEligibleUsers()`, `getUserTasks()`, etc.
- `src/app/api/cron/morning-email/route.ts` — 8 AM send
- `src/app/api/cron/afternoon-email/route.ts` — 2 PM send
- `src/app/api/cron/nightly-email/route.ts` — 9 PM send
- `src/app/api/admin/email/route.ts` — Admin compose + send + log
- `src/app/admin/email/` — Admin email UI (composer + log table)

---

## Admin Panel

**URL:** `/admin`

### Pages
- **Overview** — User count, subscription stats, email stats
- **Users** — Search, extend trial, grant premium, promote/revoke admin
- **Coupons** — Create/manage Razorpay offer-linked coupons
- **Metrics** — DAU/MAU, session stats, retention
- **Content** — AI-generated content moderation
- **Email** — Compose custom emails, view send log

### Admin Check
Uses `check_is_admin(auth.uid())` — a `SECURITY DEFINER` function that checks `profiles.is_admin`. All admin API routes verify this server-side.

---

## Important Notes

- **Currency is INR (₹)** — All prices display as ₹499, stored as 49900 paise in Razorpay
- **Pricing constants** are in `src/lib/pricing.ts` (client-safe) and `src/lib/razorpay.ts` (server-side)
- **Tailwind 4** — No `tailwind.config.js`, uses CSS-based config. Typography plugin NOT installed; use arbitrary variants like `[&_h1]:text-2xl`
- **Subscription uniqueness** — Migration 006 added `UNIQUE(user_id)` constraint on subscriptions table
- **Webhook idempotency** — `webhook_events` table deduplicates by `event_id`
- The `past_due` status is for recoverable payment failures (card retry), distinct from `expired` (terminal)
