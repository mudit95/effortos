# EffortOS — Features Roadmap

Sequenced plan for the 9 features approved during the May 2026 planning pass. Activation-prioritised per stated goal. Each item lists scope, effort, key risk, and dependencies. Wave grouping reflects what should ship together for measurable impact.

This doc is the single source of truth for "what's next." When a feature ships, mark it ✅ here and move on to the next.

---

## Wave 1 — Activation push (~6 days)

### 1. Goal templates / quick-start wizard ✅ shipped
- **What.** Six archetypes (interview prep, side project, learn-a-skill, fitness, thesis, reading) shown as cards on onboarding step 0. Picking one pre-fills goal title, estimated sessions, experience level, daily availability, consistency, deadline, and seeds the first three daily tasks. "Start from scratch" preserves the existing free-text path.
- **Why.** Drops time-to-first-session from ~10 min to ~30 sec. Single biggest activation lever.
- **Effort.** ~2 days.
- **Files.** `lib/goal-templates.ts` (new), `components/onboarding/OnboardingFlow.tsx` (modify `StepGoalInput`), `store/useStore.ts` (extend `completeOnboarding` to seed daily tasks), `types/index.ts` (add `templateId` to `OnboardingData`).
- **Risk.** Skipping motivation/context/perception steps when a template is picked needs a clean back-button story. Mitigation: jump to persona step (4), keep Back functional so users can review pre-filled fields.
- **Analytics.** Track `template_picked` events with archetype id so we know which actually convert.

### 2. Photo journals via WhatsApp ✅ shipped
- **What.** Send a pic to the bot → attaches to today's journal entry as image_url. If text accompanies, that becomes the entry body; otherwise the bot prompts "what was this?" and waits 10 min.
- **Why.** Surprising delight. Multi-modal journal extends the existing voice-note pattern. Compounds love, doesn't move metrics directly.
- **Effort.** ~1 day.
- **Files.** `lib/whatsapp.ts` (extract image_id from incoming), webhook route adds an image-handler branch parallel to voice. `journal_entries` already supports a `media_url` column? — verify; if not, migration 033 adds one.
- **Risk.** Image storage. Whisper streams audio; images need a storage location. Use Supabase Storage with RLS-scoped bucket per user.
- **Dependency.** Storage bucket setup if not already there.

### 3. Calendar integration — Google read-only
- **What.** Google OAuth, read-only Calendar scope. Dashboard shows "your free blocks today" and "suggest a session" CTA in each gap >25 min.
- **Why.** Activation amplifier — reduces "when do I focus?" friction.
- **Effort.** ~3-4 days.
- **Files.** New OAuth flow under `/api/auth/google/{init,callback}`, `lib/google-calendar.ts` for read API, dashboard component to render free blocks. Needs `oauth_tokens` table (encrypted refresh tokens). Privacy policy update.
- **Risk.** OAuth refresh token rotation. DPDP §10 implications — must document scope clearly. Easiest miss: forget to revoke when user disconnects.
- **Sign-off needed.** Privacy-policy copy update before launch.

---

## Wave 2 — Save the wavering (~4 days)

### 4. Pause subscription instead of cancel ✅ shipped
- **What.** Cancellation flow gets a "pause for 1 month" intercept. Razorpay supports paused subscriptions natively; resume on day 30 or via user action.
- **Why.** Catches churners who'd otherwise leave for "I just need a break." SaaS-standard save tactic.
- **Effort.** ~1 day.
- **Files.** `/api/subscription/cancel` adds a `mode: 'pause' | 'cancel'` body param. `SettingsModal` cancellation modal gets a "pause" button. Razorpay webhook handles `subscription.paused` and `subscription.resumed` events. New migration adds `paused_until` column.
- **Risk.** Past-due users shouldn't see the pause option (they need to fix payment first). Gate by current status.

### 5. Streak freezes + lapse recovery ⏳ Wave 2 first half shipped (mig 035, freeze-aware streak math, /api/streaks/freeze endpoint, store action, StreakCalendar CTA). Cron + WhatsApp intent + lapse modal + welcome-back email queued for follow-up — see task #38.
- **What.** Two parts:
  - **Freeze tokens.** 1/month free tier, 3/month Pro. Token consumed when a missed day would otherwise break the streak. Auto-applied at UTC midnight when streak is at risk.
  - **Lapse recovery.** When a user returns after 7+ days dormant, "welcome back" flow with 1-tap "start a quick 25 min" + last-week recap. Doesn't show empty streak as 0 — shows "longest 47, taking a break, want to restart?"
- **Why.** Streaks drive Pomodoro retention; the lapse moment is your biggest bleed point.
- **Effort.** ~3 days.
- **Files.** New `streak_freezes` table (mig 033 or 034). Cron `apply-streak-freezes` runs at user-local midnight. `getStreaks()` in `lib/utils.ts` becomes freeze-aware. Re-engagement email template + return-flow modal.
- **Risk.** Auto-applying freezes silently feels magical when intended, sketchy when overused. Cap at 1/week even on Pro.

---

## Wave 3 — Pro moat + growth (~7 days)

### 6. Daily AI report card
- **What.** Distinct from the existing nightly email. A dashboard card + optional WhatsApp message at end-of-day with: today's focus minutes, completion rate, mood-vs-output observation if journaled, one-line AI suggestion for tomorrow.
- **Why.** Daily mirror feels personal. Free + Pro both get the basic card; Pro gets the AI suggestion line.
- **Effort.** ~2 days.
- **Files.** `lib/coach-ai.ts` adds `generateDailyCard()`. New `DailyCard` dashboard component. Hook into `/api/cron/nightly-email` to also write the card to a new `daily_cards` table (mig).
- **Risk.** Quota: Pro AI suggestion costs Anthropic tokens × 1k Pro users × daily. Cap via `aiQuota`. Free tier renders the descriptive part with no LLM call.

### 7. Weekly AI report card (Pro)
- **What.** Friday/Sunday email + dashboard card. Prescriptive: "Your completion rate is 78% in mornings vs 41% in afternoons. Three abandoned tasks were tagged 'job' between 2-4 PM. Want to try moving them to mornings?" Includes a one-tap "rebalance my next week" CTA.
- **Why.** Strengthens Pro moat. Drives Starter→Pro upgrades. Friday-email habit users wait for.
- **Effort.** ~3 days.
- **Files.** `lib/coach-ai.ts` adds `generateWeeklyReport()`. New cron `/api/cron/weekly-report` (Sunday 7 PM user-local). Dashboard card. Email template.
- **Risk.** Hallucinated insights — the model invents patterns that aren't in data. Mitigation: feed it only aggregated stats, never raw timestamps; have it cite specific numbers.

### 8. Referral coupons
- **What.** "Refer a friend, both get 1 month free." Generates a unique code per user via `coupons` table (already exists). Tracks redemptions in `coupon_redemptions`. Dashboard "Invite friends" section + share-link CTA.
- **Why.** Cheap acquisition channel. Social loop using existing infrastructure.
- **Effort.** ~2 days.
- **Files.** Per-user coupon generator, dashboard panel, share UX (copy link / WhatsApp / Twitter). Free-month redemption logic already exists for `kind='free_months'`.
- **Risk.** Self-referral abuse — same user creating fake accounts. Mitigate via email-verification + IP throttle.

### 9. Social streak share
- **What.** Public read-only URL `/share/streak/<token>` showing the user's current streak count, longest streak, days since starting. Generates an OG image so the link unfurls beautifully on Twitter / WhatsApp / iMessage. CTA on the page: "build your own streak with EffortOS."
- **Why.** Organic acquisition. Streaks are the most shareable Pomodoro artefact. Built on the existing OG image infrastructure (`opengraph-image.tsx`).
- **Effort.** ~1-2 days.
- **Files.** New `/share/streak/[token]/page.tsx` route. New `share_tokens` table (mig). OG image generator at `/share/streak/[token]/opengraph-image.tsx`. Dashboard "Share streak" button.
- **Risk.** Token guess. Use 32-char crypto-random tokens. Privacy: only show streak counts, never task content.

---

## Sequencing rationale

Wave order is chosen so each wave moves a different metric:
- **Wave 1**: activation. New users hit first session faster.
- **Wave 2**: retention. Engaged users stay engaged through life events.
- **Wave 3**: monetisation + growth. Pro upgrades + viral acquisition.

Doing Wave 3 before Waves 1-2 fills a leaky bucket. Doing Wave 2 before Wave 1 means there's nothing to retain. The order is the order.

## Already-deferred work (separate from this list)

Items from `PHASE3_DESIGN.md` and `AUDIT_FINDINGS.md` that should compete for the same calendar weeks:

- **Bandit nudge timing** (~3 days) — high UX lift; could swap into Wave 3.
- **Voice TTS replies** (~2 days) — Pro feature; pairs naturally with Wave 3.
- **Migration 032 cross-user goal CHECK** — security fix from audit, ~1 day, should land before any new user-data feature.
- **Coach concurrency drop + backoff** — operational fix, ~1 day, do before user count hits 200.
- **Email-cron 60s ceiling** — operational, needs Vercel Pro upgrade or pagination decision.

Recommend interleaving 1-2 of these per wave. Don't let security/ops debt accumulate behind features.

---

*Last updated: 2026-05-01. Update each item's status as it ships: ⏳ in progress, ✅ shipped, ⏸ paused, ❌ dropped.*
