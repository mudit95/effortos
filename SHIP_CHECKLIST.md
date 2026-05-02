# Ship Checklist — Wave 2 + Wave 3 + Platform Review fixes

This is the deploy runbook for the everything-batch sitting on `main` right now.
Pre-flight has already been done in the dev sandbox: `npx tsc --noEmit` clean,
`npx eslint src/ tests/` clean. The only thing the sandbox couldn't do is the
actual `git commit && git push` (sandbox can't write into `.git/`). Run the steps
below on your machine.

---

## What's in this batch

| Area | Files |
|---|---|
| **DB migrations** | `supabase/migrations/031_billing_cadence.sql`, `032_wa_conversation_context.sql`, `033_journal_media.sql`, `034_subscription_pause.sql`, `035_streak_freezes.sql`, `036_focus_background.sql`, `037_daily_cards.sql` |
| **Annual subscription** | `src/lib/pricing.ts` (₹ normalizer), `src/lib/razorpay.ts`, `src/app/api/subscription/create/route.ts`, `src/app/api/subscription/status/route.ts`, `src/app/api/webhooks/razorpay/route.ts`, `src/components/subscription/PaywallModal.tsx`, `src/components/subscription/PremiumGate.tsx`, `src/components/layout/LandingPage.tsx`, `scripts/create-annual-plans.js` |
| **Pause / resume** | `src/app/api/subscription/pause/`, `src/app/api/subscription/resume/`, `SettingsModal.tsx` wiring |
| **Smarter WhatsApp bot** | `src/lib/whatsapp-ai.ts`, `src/lib/wa-conversation.ts`, `src/lib/whatsapp.ts`, `src/app/api/whatsapp/webhook/route.ts`, tests `whatsapp-ai`, `whatsapp-extract`, `wa-conversation` |
| **Goal templates** | `src/lib/goal-templates.ts`, `OnboardingFlow.tsx` wiring, tests |
| **Photo journals** | `JournalModal.tsx`, `033_journal_media.sql` (storage policies), `whatsapp-ai.ts` photo intake |
| **Streak freezes + lapse recovery** | `src/components/dashboard/LapseRecoveryModal.tsx`, `src/app/api/streaks/`, `src/app/api/cron/apply-streak-freezes/`, `src/app/api/cron/replenish-freeze-tokens/`, tests |
| **Focus backgrounds (audio + video)** | `src/lib/focus-backgrounds.ts`, `BackgroundPicker.tsx`, `FocusBackgroundLayer.tsx`, `FocusMode.tsx`, `public/sounds/*.mp3` (7 files, 16 MB), `public/backgrounds/*.mp4` (6 files, 11 MB) |
| **Daily AI card (Wave 3 part 1)** | `src/components/dashboard/DailyCard.tsx`, `src/app/api/coach/daily-card/`, `037_daily_cards.sql` |
| **Pact cancel button** | `PactsSection.tsx` |
| **Platform-review fixes (a11y / cache / copy)** | `Dashboard.tsx`, `ModeToggle.tsx`, `SettingsModal.tsx`, `StreakCalendar.tsx`, `DailyGrind.tsx`, `Reports.tsx`, `DailyBrief.tsx`, `MotivationMessage.tsx`, `useStore.ts` (welcome-email cache) |
| **Cron config** | `.github/workflows/cron.yml` (added `apply-streak-freezes` and `replenish-freeze-tokens`) |
| **Docs** | `HANDOFF.md`, `FEATURES_ROADMAP.md`, `PHASE3_DESIGN.md`, `PLATFORM_REVIEW.md`, `STREAK_FREEZES_DESIGN.md`, `AUDIT_FINDINGS.md` |

---

## Step 1 — Commit & push

```bash
cd ~/Downloads/Pomodoro_app/effortos

# Migrations as their own commit (so DB rollback is clean if needed)
git add supabase/migrations/03[1-7]_*.sql
git commit -m "db: migrations 031-037 (billing cadence, WA context, journal media, sub pause, streak freezes, focus bg, daily cards)"

# Application code + assets + docs in one ship-it commit
git add -A
git commit -m "feat: Wave 2 + Wave 3 part 1 + platform-review fixes

- Annual subscription tier (₹3,999 Starter / ₹7,999 Pro, ~33% off)
- Pause/resume subscription
- Smarter WhatsApp bot (conversation memory, multi-intent, clarify, add_goal)
- Goal templates wizard, photo journals
- Streak freezes + lapse recovery + freeze tokens cron
- Focus mode video + audio backgrounds (7 audio, 6 video assets)
- Daily AI card (Pro: prescriptive line, free: descriptive only)
- Pact cancel button (settings declutter)
- Platform-review a11y + cache + copy fixes
"

git push origin main
```

Vercel auto-deploys on push to `main`. Watch the build log — should be green; tsc + eslint already pass locally.

---

## Step 2 — Apply migrations

Open Supabase → SQL editor → run each file in order. They're idempotent (`IF NOT EXISTS` etc.) but apply them in numeric order so foreign keys resolve:

1. `031_billing_cadence.sql` — adds `billing_cadence` column to `subscriptions`
2. `032_wa_conversation_context.sql` — `wa_conversation_context` table
3. `033_journal_media.sql` — `journal_media` table + storage bucket policies
4. `034_subscription_pause.sql` — `paused_at`, `resumed_at` on `subscriptions`
5. `035_streak_freezes.sql` — `streak_freezes` table + `claim_freeze_token` RPC
6. `036_focus_background.sql` — `focus_background` JSONB column on `profiles`
7. `037_daily_cards.sql` — `daily_cards` table

Quick verify after each:
```sql
-- 035 sanity
select * from claim_freeze_token('00000000-0000-0000-0000-000000000000');  -- should return null/no rows for fake user
-- 037 sanity
select count(*) from daily_cards;
```

---

## Step 3 — Razorpay annual plans

Annual plans aren't auto-created. Run the helper:

```bash
node scripts/create-annual-plans.js
```

It reads `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` from `.env.local`, creates the
two annual plans (Starter ₹3999, Pro ₹7999, billing_cycle=12), and prints the
plan IDs. Copy them into Vercel env:

- `RAZORPAY_STARTER_ANNUAL_PLAN_ID=plan_…`
- `RAZORPAY_PRO_ANNUAL_PLAN_ID=plan_…`

Redeploy Vercel after setting env vars (Vercel → Settings → Environment Variables →
Save → Deployments → re-deploy latest).

---

## Step 4 — Smoke tests on prod

Hit https://effortos-zeta.vercel.app and check:

1. **Subscription card shows ₹** — Settings → Subscription. `pricing.ts`'s
   `withRupee` normalizer fixes the missing-symbol bug whether or not you
   touch `NEXT_PUBLIC_PRO_PRICE` env. Should read `₹999/month` (or `₹7,999/year`).
2. **Annual toggle on paywall** — open the upgrade modal as a free user;
   monthly/annual toggle should be present and ~33% saving copy visible.
3. **Pause subscription** — Settings → Subscription → Pause. Should mark
   `paused_at` in DB; resume restores.
4. **Streak freeze CTA** — break a streak in dev; lapse-recovery modal should
   surface on next dashboard mount.
5. **Focus backgrounds** — Focus Mode → background picker. All 7 audio + 6
   video options should load (16 MB + 11 MB total — first load may take a
   beat, then they cache).
6. **WhatsApp bot smarter intents** — text "I want to add a new goal: learn
   guitar in 30 days" → bot should clarify daily session count and create the
   goal. Multi-intent (e.g., "log a journal and start a 25-min session")
   should chain.
7. **Daily card** — bottom of dashboard. Free users see 3-stat band + Pro
   upsell line; Pro users see 3-stat band + "For tomorrow:" cyan line.
8. **Pact cancel** — Settings → Pacts → unaccepted invites have a Cancel
   button; clicking it removes them from view.
9. **A11y spot-checks** — open Settings (dialog role + escape), tab through
   ModeToggle (proper tablist/tab semantics), inspect StreakCalendar weekday
   row in DevTools (each cell has full-day-name aria-label).

---

## Step 5 — Cron jobs

`.github/workflows/cron.yml` now schedules two new jobs:

- `apply-streak-freezes` — daily 00:05 UTC, drains pending freeze claims
- `replenish-freeze-tokens` — Sunday 00:10 UTC, refills weekly token grants

After push, GitHub Actions tab → Cron workflow → confirm both are listed and
schedule next run is ~midnight UTC. Manual trigger once via "Run workflow"
to verify they hit the API and 200.

---

## Out of scope for this batch (Wave 3 backlog)

- Weekly AI Pro report card (~3 days)
- Referral coupons (~2 days)
- Social streak share (~1-2 days)
- PHASE3_DESIGN.md deferred: bandit nudge timing, voice TTS replies, full
  pact ops over chat, milestone-via-chat

---

## Production-launch blockers (from HANDOFF.md, unchanged by this batch)

1. **Custom domain + Resend domain verification** — transactional email sends
   are still routed through `onresend.dev` test domain.
2. **Razorpay live-mode KYC** — currently in test mode; live keys require KYC.
3. **WhatsApp Cloud API templates approval** — Meta Business Manager → submit
   the templates referenced in `src/lib/whatsapp.ts` for the bot to send
   first-message-of-the-day pings.
