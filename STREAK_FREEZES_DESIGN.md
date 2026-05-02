# Streak Freezes + Lapse Recovery — Design Spec

Wave 2 retention feature, deferred to its own session because the surface area is bigger than a single-turn build:
- New table + indexes
- Per-user-local-midnight cron with timezone correctness
- Freeze-aware streak math (replaces `getStreaks` in `src/lib/utils.ts`)
- New UI: token counter, "freeze today" CTA, lapse-recovery modal
- New email template + transactional send for return flows

This doc is the contract before the build. Sign off on the questions at the bottom and I'll execute in the next session.

---

## Why this matters

Streak preservation is the dominant retention mechanic in Pomodoro/habit apps. Industry data (Habitica, Streaks, Duolingo) consistently shows ~80% of users who break a 30+ day streak never return — a single bad week is terminal. EffortOS already has this exact bleed: `getStreaks()` is unforgiving, and the `re-engagement` cron only fires after 14 days dormant, by which point the streak shame has done its work.

Two parts to the fix:
1. **Freeze tokens**: a "free pass" mechanism that protects the streak when life happens (sick day, travel, surgery). Used proactively by the user OR auto-applied at midnight.
2. **Lapse recovery**: when a returning user opens the app after 7+ days dormant, route them through a "welcome back" flow that doesn't punish the absence — show longest-streak + last-week recap + 1-tap "start a quick 25 min" CTA.

---

## Schema — migration 035

```sql
-- 035: Streak freezes + lapse tracking
--
-- streak_freezes table: one row per used freeze. Append-only; we never
-- delete or update rows. The CONSUMED state is implicit in row existence.
CREATE TABLE public.streak_freezes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Calendar date (user-local) the freeze covers — i.e., the day the
  -- streak would otherwise have broken. UNIQUE(user_id, date) so a
  -- single day can't burn two tokens.
  date        DATE NOT NULL,
  -- 'auto' = applied by midnight cron; 'manual' = user clicked the
  -- "freeze today" CTA. Useful for analytics ("are users hitting the
  -- manual button or just relying on auto?").
  source      TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, date)
);

CREATE INDEX idx_streak_freezes_user_date
  ON public.streak_freezes(user_id, date DESC);

-- Per-user monthly freeze quota tracking. We could compute this from
-- streak_freezes count in the current month, but a stored counter is
-- cheaper and lets us atomically claim a token (insert into freezes +
-- decrement counter in a single transaction or via a postgres function).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS freeze_tokens_remaining INT NOT NULL DEFAULT 1
    CHECK (freeze_tokens_remaining >= 0),
  ADD COLUMN IF NOT EXISTS freeze_tokens_resets_at DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '1 month'),
  -- Track the last day the user had any session activity in their local
  -- timezone. Used by the lapse-recovery flow to detect "first visit
  -- after a 7+ day absence" without re-running session aggregations.
  ADD COLUMN IF NOT EXISTS last_session_date DATE;

ALTER TABLE public.streak_freezes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own freezes"
  ON public.streak_freezes FOR SELECT USING (auth.uid() = user_id);
-- All writes service-role only (cron + freeze API).
```

**Quotas:**
- Free tier: `freeze_tokens_remaining = 1` per month.
- Pro tier: `freeze_tokens_remaining = 3` per month.
- Reset cadence: monthly, anchored to user's signup month-day. Cron `replenish-freeze-tokens` runs daily and replenishes any user whose `freeze_tokens_resets_at <= CURRENT_DATE`.

---

## Freeze logic — three trigger paths

### A. Auto-apply at user-local midnight

Cron `apply-streak-freezes` runs hourly (existing pattern). For each user whose local time is between 23:50 and 00:10:
1. Compute streak status as of "now" in user-local time.
2. If user has an active streak ≥ 3 days AND no completed session for today AND `freeze_tokens_remaining > 0`:
   - Atomically: insert into `streak_freezes` (source='auto') + decrement counter.
   - If insert succeeds (UNIQUE didn't trip), send WhatsApp/email "we used a freeze to protect your X-day streak — sleep well."
3. Idempotent — running the cron twice in the same hour is a no-op due to the UNIQUE constraint.

**Cap inside the cap**: max 1 auto-freeze per 7-day window even on Pro. Pro's 3 tokens/month are mostly meant for manual "I know I'll be off this week" use — auto-spamming all 3 in week 1 leaves the user defenseless for the rest of the month.

### B. Manual freeze (proactive)

UI: dashboard "Freeze today's streak" CTA visible when user has tokens remaining. Single tap → `POST /api/streaks/freeze` → same atomic insert + decrement → toast "Streak protected for today."

Surfaced in:
- StreakCalendar component (badge on today's tile).
- Settings → "Streak protection."
- WhatsApp intent: `freeze_streak` (new intent in `whatsapp-ai.ts`, ~10 lines including hardenIntent rules).

### C. Retroactive freeze (the day after)

Industry standard ("I missed yesterday — can I save it?"). Window: 24 hours after the missed day's local midnight. Same endpoint, just checks the `date` parameter is today OR yesterday-local. Beyond that, the streak is gone — keeps the system honest.

---

## getStreaks rewrite

The current implementation in `src/lib/utils.ts` walks the sessions list backward from today and breaks on the first day with zero completed sessions. The freeze-aware version:

```ts
function getStreaksWithFreezes(
  sessions: Session[],
  freezes: { date: string }[],
  todayLocal: string,
): { current: number; longest: number } {
  const sessionDays = new Set(
    sessions.filter(s => s.status === 'completed')
      .map(s => localDayKey(s.start_time))
  );
  const freezeDays = new Set(freezes.map(f => f.date));
  // ... walk back, treating freezeDays as "covered" instead of breaks.
}
```

Two behaviour notes:
- A freeze covers the day but doesn't COUNT toward the streak number. So a 7-day streak with one freeze on day 4 reads as "7-day streak (1 freeze used)."
- Longest-streak math respects freezes the same way.

---

## Lapse recovery flow

Triggered when a user opens the dashboard AND `last_session_date < today - 7d`.

UI: full-screen welcome-back modal (mounted by `AppShell` based on a new `pendingLapseRecovery` store flag).
- Heading: "Welcome back, {name}."
- Stats card: longest streak ever, total focus hours since signup. NOT the current (broken) streak — that's punishment.
- One-line summary of what the user missed: "{n} crons fired since you were last here, your weekly recap on {date} is below."
- CTA: "Start a quick 25 min" → opens FocusMode in a guest-style flow without forcing goal selection.
- Secondary: "Set up a goal again" → onboarding wizard.

The flag is set on the next `fetchSubscriptionStatus` call when the date check passes. Cleared after the user dismisses or starts a session.

---

## Email integration

New transactional email `welcomeBackEmail` sent by re-engagement cron when:
- User has been dormant 7+ days, AND
- They haven't received this template in the last 60 days (to avoid weekly nags).

Template offers the same "1-tap quick session" deeplink that the modal provides. Subject: "Your seat's still warm" (or persona-flavoured variant).

---

## Sign-off questions

1. **Token quotas**: 1/month free + 3/month Pro is my recommendation. Anything bigger feels like the streak doesn't matter. Smaller risks looking stingy. Want to flex either?
2. **Auto-freeze trigger threshold**: only protects streaks ≥ 3 days. Below that the user hasn't built habit muscle yet, and protecting it would mask the activation problem. OK?
3. **Retroactive window**: 24 hours after midnight. Anything longer creates a "I'll claim tomorrow" loophole. OK?
4. **Lapse-recovery threshold**: 7 days dormant. Sooner feels nagging; later misses the recovery moment. Fine to flip to 5 or 10 if you've got data preferences.
5. **WhatsApp intent**: should `freeze_streak` ship in the same wave, or wait? My take: ship it together — one of the strongest "smart bot" use cases.
6. **Email cadence**: 60-day cooldown on the `welcomeBackEmail`. Aggressive enough to catch true returners, conservative enough that we don't email someone who tries the app once a quarter forever. OK?

---

## Effort

- Migration 035: ~30 min.
- `apply-streak-freezes` cron + `replenish-freeze-tokens` cron + GitHub Actions wiring: ~1 day.
- `getStreaksWithFreezes` rewrite + tests: ~half day.
- UI (token counter in StreakCalendar, manual freeze CTA, lapse modal): ~1 day.
- Email template + re-engagement integration: ~half day.
- WhatsApp `freeze_streak` intent: ~half day.

**Total: ~3.5 days end-to-end.** Same estimate as the `FEATURES_ROADMAP.md` Wave 2 entry; this doc just expands the scope without changing the headline.

---

## What I'd build next session, in this order

1. Migration 035 (schema first — unblocks everything else).
2. `getStreaksWithFreezes` + unit tests (logic, no UI).
3. `/api/streaks/freeze` endpoint + manual-freeze CTA.
4. `apply-streak-freezes` cron + WhatsApp opt-in test.
5. Lapse-recovery modal + `last_session_date` tracking.
6. Welcome-back email + re-engagement cron integration.
7. WhatsApp `freeze_streak` intent.

Each is ~half day in real time; one focused session can ship items 1-4. Items 5-7 want a follow-up session.
