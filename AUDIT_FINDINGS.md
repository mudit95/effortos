# EffortOS — Stability & Scalability Audit Findings

*Audit run: 2026-05-01. Method: four parallel sub-agents read the highest-risk surfaces (store, WhatsApp+AI, cron infrastructure, DB/RLS/API) and reported file-line findings. The list below is the triaged, verified version — spurious findings dropped, severities adjusted against actual code, and high-risk items flagged for sign-off.*

---

## Status legend

- **APPLIED** — fix landed in this session, see file diff
- **VERIFIED, DEFERRED** — bug confirmed but fix needs design discussion or larger refactor
- **SPURIOUS** — agent finding didn't match actual code; no action needed
- **DESIGN TRADE-OFF** — current code is intentional per existing comments; documented for future readers

---

## CRITICAL

### 1. Voice transcript bypassed AI quota — APPLIED
**File:** `src/app/api/whatsapp/webhook/route.ts:1726`
**Issue:** Every text-message call site of `parseWhatsAppMessage` passes `{ userId, tier }` so tokens are charged against the per-user daily Anthropic cap (`aiQuota.ts`). The voice-note branch silently omitted both arguments — Whisper transcripts could burn unlimited tokens.
**Fix applied:** Looked up `aiTier` via `getUserAiTier(supabase, profile.id)` and passed `{ userId, tier }` through, matching the text path exactly.

### 2. AI quota fails OPEN in production when Redis is unconfigured — APPLIED
**File:** `src/lib/aiQuota.ts:99-102`
**Issue:** When `getRedis()` returned `null`, the function returned `{ ok: true, limit: ∞ }` — explicitly "fail-open in dev / unconfigured prod". In production this means a single misconfigured Upstash key disables the entire cost-control mechanism; a single user could burn arbitrary Anthropic spend.
**Fix applied:** In `NODE_ENV === 'production'`, fail closed (return `{ ok: false }` with the tier's limit and a `resetAt` at UTC midnight) and log loudly. Dev still fails open so local testing without Upstash works.

### 3. Admin coupon mutations had no audit trail — APPLIED
**File:** `src/app/api/admin/coupons/route.ts`
**Issue:** `lib/adminAudit.ts` defines `COUPON_CREATED` and `COUPON_TOGGLED_ACTIVE` action types but the route never invoked `logAdminAction`. SOC 2 / DPDP §10 expects every privileged mutation to leave a forensic trail; "who created the 100% off coupon?" had no answer beyond log scraping.
**Fix applied:** Both POST (create) and PATCH (toggle active) now log via service-role client after success. Payload includes code, kind, discount value, and (for toggle) the new active state.

### 4. Admin custom-email broadcast had no audit trail — APPLIED
**File:** `src/app/api/admin/email/route.ts`
**Issue:** Same gap as #3 — `ADMIN_EMAIL_SENT` action type defined but never logged. A privileged broadcast that can reach every paying user with no record of who sent it.
**Fix applied:** Logged after the send loop with target segment, subject (truncated to 200 chars), recipient count, sent count, and errors count.

### 5. Cross-user goal linkage in `daily_tasks` — VERIFIED, DEFERRED
**Files:** `supabase/migrations/012_daily_tasks_goal_id.sql`, `src/app/api/sessions/complete/route.ts:75-117`
**Issue:** `daily_tasks.goal_id` has a FK to `goals.id` but no constraint enforcing same-user ownership. `/api/sessions/complete` validates the session belongs to the user but doesn't re-validate that the linked goal does. RLS makes this hard to exploit in practice (the user can't read another user's goals to know an ID) but defence-in-depth wants a DB-level constraint.
**Recommended fix:** Migration 032 — trigger or composite-FK that enforces `daily_tasks.user_id = goals.user_id`. Want sign-off before writing because the migration needs careful backfill validation.

---

## HIGH

### 6. `/api/sessions/complete` had no rate limit — APPLIED
**File:** `src/app/api/sessions/complete/route.ts`
**Issue:** Every other write endpoint uses `rateLimitOrNull(user.id, 'light')` but session-complete didn't. A confused offline-queue replay loop or a script could hammer goal/milestone increments faster than the data caps (mig 029) can throttle.
**Fix applied:** Added `'light'` bucket (20/hr) at the top of the handler.

### 7. `cron_run_log` retention was a comment, not enforced — APPLIED
**File:** `src/app/api/cron/retention-sweep/route.ts`
**Issue:** Migration 030's comment promised retention-sweep would prune `cron_run_log`, but `SWEEP_TARGETS` didn't include the table. At ~7 rows/hour × 11 crons = ~77 rows/hour, the table grew unbounded.
**Fix applied:** Added `{ table: 'cron_run_log', retentionDays: 30, timestampColumn: 'ran_at' }` to `SWEEP_TARGETS`.

### 8. `useRealtimeSync` had unused `initializeApp` in deps array — APPLIED
**File:** `src/hooks/useRealtimeSync.ts:87`
**Issue:** Audit claimed Zustand action references aren't stable, which is wrong (they are). But `initializeApp` was in the deps array and never referenced inside the effect — pure dead weight that survived a refactor.
**Fix applied:** Removed `initializeApp` from the deps array, added a comment explaining why `refreshDailyTasks` is safe to keep.

### 9. Pending-flow Redis keys collide between `journal` and `reflection` — DESIGN TRADE-OFF
**File:** `src/lib/whatsapp-state.ts:57`
**Issue:** Both flows use `wa:pending:${phone}` so a reflection prompt overwrites a journal prompt mid-flow. The code comment explicitly calls this last-write-wins behaviour.
**Recommendation:** Keep current design for now (rare collision in practice — reflection only fires Sunday 8 PM). When phase-3 conversational memory lands, switch to `wa:pending:${phone}:${flowType}` so multiple flows can coexist. Documented as a known limitation.

### 10. Coach cron concurrency may exceed Anthropic RPM — VERIFIED, DEFERRED
**File:** `src/app/api/cron/coach/route.ts:97`
**Issue:** `COACH_CONCURRENCY = 10` with ~3-4 s per Anthropic call could push 120-180 RPM. Default Anthropic tier is 5 RPM. The first 429 cascades through the entire batch.
**Recommended fix:** Drop to `3` and add exponential-backoff retry around `generateCoachMessage`. Need sign-off because dropping concurrency 3.3× extends wall-clock time and could push the cron toward the 60s ceiling at scale.

### 11. Email crons hit 60s ceiling at scale — VERIFIED, DEFERRED
**File:** `src/app/api/cron/morning-email/route.ts` (and afternoon-, nightly-)
**Issue:** `concurrentMap(users, 8, ...)` × ~3 s per user → ~190 s for 500 eligible users. Vercel Hobby caps at 60 s. Currently safe at <200 active users; will start failing silently around 200-300.
**Recommended fix:** Either upgrade to Vercel Pro (300 s ceiling) or paginate via `?offset=` and trigger 4 parallel cron invocations from GitHub Actions. Architectural; needs sign-off.

### 12. Re-engagement cron pulls all auth users into memory — VERIFIED, DEFERRED
**File:** `src/app/api/cron/re-engagement/route.ts:141`
**Issue:** `listAllAuthUsers(supabase)` pages through every auth user (could be 100k+) just to map ~1k IDs. Memory grows O(auth user count), not O(target count).
**Recommended fix:** Replace with a per-target `auth.admin.getUserById()` loop or a batched-by-ID page fetch. Easy fix, but worth verifying the helper isn't shared by a path that needs the full list.

---

## MEDIUM

### 13. `pact-activity` cron uses UTC "yesterday" across timezones — VERIFIED, DEFERRED
**File:** `src/app/api/cron/pact-activity/route.ts:110-114`
**Issue:** Computes `yesterdayStart`/`yesterdayEnd` in UTC. A US-PST user and an India-IST partner see ~13.5 h offset between their respective "yesterdays".
**Recommendation:** Per-partner local-timezone window. Add to phase-3 backlog.

### 14. `purge-deleted-accounts` race vs. undelete — VERIFIED, DEFERRED
**File:** `src/app/api/cron/purge-deleted-accounts/route.ts`
**Issue:** No SELECT FOR UPDATE / atomic test before hard-delete; an undelete request in flight could lose to the cron.
**Recommendation:** Wrap `hardDeleteAccount` in a transaction that re-reads `deleted_at` and aborts if it's been NULLed.

### 15. Coaching pause expires in UTC, not user local — VERIFIED, DEFERRED
**File:** `src/lib/coach-engine.ts:121`
**Issue:** Pause stored as ISO string compared in UTC; for a user in IST the pause expires 5.5 h earlier than expected.
**Recommendation:** Document or convert to user local; small UX bug, low impact.

### 16. JSONB `contains` filter on `email_log` is quadratic — VERIFIED, DEFERRED
**File:** `src/app/api/cron/trial-ending/route.ts:91-98`
**Issue:** Per-subscription JSONB lookup does a full scan; 100 trialing subs = 100 scans.
**Recommended fix:** GIN index on `email_log(metadata)` or denormalised `subscription_id` column.

### 17. Watchdog stale threshold (90 min) allows two silent misses — VERIFIED, DEFERRED
**File:** `src/lib/cron-run-log.ts:36-39`
**Recommendation:** Drop to 75 min for hourly crons, or alert on "2 consecutive failures".

### 18. Soft-deleted users can still UPDATE profile via direct API — DESIGN TRADE-OFF
**File:** `supabase/migrations/028_soft_delete_profiles.sql:44-52`
**Issue:** Migration comment explicitly says RLS doesn't enforce this — API layer does. Risk: any code path that writes to profiles must check `deleted_at`.
**Recommendation:** Long-term, add a RLS WITH CHECK predicate restricting updates while soft-deleted. Documented trade-off for now.

### 19. Email preferences default-eligible logic includes never-created rows — VERIFIED, DEFERRED
**File:** `src/app/api/admin/email/route.ts:74-75`
**Issue:** Users without an `email_preferences` row are included in broadcasts. Migration 008 backfilled rows for existing users, but new signups depend on the trigger; mig 021 made profile creation resilient, but if email_preferences trigger ever fails the user receives email by default.
**Recommended fix:** Add a backfill cron that creates missing `email_preferences` rows nightly.

### 20. Admin actions table lacks plain `(created_at DESC)` index — LOW PRIORITY
**File:** `supabase/migrations/026_admin_audit.sql:42-47`
**Recommendation:** Add `idx_admin_actions_time` if a "recent admin actions" dashboard is built. Otherwise the three compound indexes are sufficient.

### 21. ConcurrentMap has no per-task timeout — VERIFIED, DEFERRED
**File:** `src/lib/concurrency.ts:22-49`
**Issue:** A hung Resend or Meta API call blocks all 8 workers; `Promise.all` never resolves; cron 60s-times out.
**Recommended fix:** Wrap each task in `Promise.race([task, timeoutAfter(15000)])`.

### 22. Numbered-reply task list cache key is phone-only — DESIGN TRADE-OFF
**File:** `src/lib/whatsapp-state.ts:58-59`
**Issue:** Two users sharing a phone (rare) could see cross-contamination. Currently single-user-per-phone is enforced at signup.
**Recommendation:** Switch to `userId:phone` keys when multi-account-per-phone becomes a real use case.

### 23. WA voice transcript not length-checked before parser — VERIFIED, DEFERRED
**File:** `src/app/api/whatsapp/webhook/route.ts:1726` (just-applied fix)
**Issue:** Whisper can return 10k+ char transcripts for long voice notes; `parseWhatsAppMessage` truncates internally but length check happens after the quota gate.
**Recommended fix:** Add explicit `transcript.slice(0, MAX_PARSER_INPUT_CHARS)` before the parser call. Low effort but want sign-off on whether to truncate or reject.

---

## LOW / NOTED

### 24. Migration 006 dedup is destructive without backfill log
**File:** `supabase/migrations/006_subscriptions_dedup.sql`
Already-shipped; future destructive migrations should log deleted rows to a temp table first.

### 25. Pacts table allows self-pacts (no CHECK constraint)
**File:** `supabase/migrations/018_pacts_and_task_scheduling.sql:13`
UI prevents this; DB doesn't. Add `CHECK (user_id != partner_user_id)` if it becomes a problem.

### 26. Unsubscribe-token fallback uses service-role key
**File:** `src/lib/unsubscribe-token.ts:28-53`
If `SUPABASE_SERVICE_ROLE_KEY` is rotated, all unsubscribe tokens silently invalidate. Make `UNSUBSCRIBE_SECRET` mandatory in production.

### 27. Consent log stores raw IP+UA without salting
**File:** `supabase/migrations/027_consent_log.sql:31-32`
By design (audit trail); document in privacy policy.

---

## SPURIOUS FINDINGS (no action needed)

- **Webhook signature verified after JSON parsing** — agent self-retracted; signature is checked first.
- **`useRealtimeSync` deps thrash on every store mutation** — Zustand action references are stable; the dep array was harmless (just had unused `initializeApp`, removed).
- **`coach-log` FK CASCADE redundant with explicit delete** — defensive belt-and-braces; not a bug.
- **`pact_user_stats` view leaks data** — already fixed in migration 022 (`security_invoker = true`).
- **Coach cron missing Pro-tier verification** — line 71-79 explicitly filters Pro + trialing/active.
- **cron-auth bypasses in production with missing CRON_SECRET** — current code returns 500 in prod, only allows in `NODE_ENV === 'development'`.

---

## FIX SUMMARY (this session)

| # | File | Fix | Severity |
|---|------|-----|----------|
| 1 | `src/app/api/whatsapp/webhook/route.ts` | Voice transcript routes through AI quota | CRITICAL |
| 2 | `src/lib/aiQuota.ts` | Fails closed in production when Redis missing | CRITICAL |
| 3 | `src/app/api/admin/coupons/route.ts` | Audit log on POST + PATCH | CRITICAL |
| 4 | `src/app/api/admin/email/route.ts` | Audit log after send loop | CRITICAL |
| 6 | `src/app/api/sessions/complete/route.ts` | Light rate-limit on session complete | HIGH |
| 7 | `src/app/api/cron/retention-sweep/route.ts` | `cron_run_log` added to sweep targets | HIGH |
| 8 | `src/hooks/useRealtimeSync.ts` | Removed dead `initializeApp` from deps | HIGH |

7 fixes applied. 16 items deferred for sign-off (migration changes, architectural decisions, or careful refactors). 6 spurious findings dropped.

---

## RECOMMENDED PHASE 2 NEXT STEPS

1. **Sign off on migration 032** for cross-user goal linkage CHECK (#5).
2. **Pick a strategy** for the email-cron 60s ceiling (#11) — Vercel Pro upgrade vs. cron pagination.
3. **Drop coach concurrency to 3** with backoff (#10) before active-user count exceeds ~200.
4. **GIN index on `email_log(metadata)`** to fix trial-ending cron quadratic query (#16).
5. **Backfill cron for missing `email_preferences` rows** (#19).
6. **Per-task timeout in `concurrentMap`** (#21) — small change, big resilience win.

Items 4-6 are low-risk and could land in a follow-up turn without sign-off.
