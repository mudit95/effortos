# Phase 3 — WhatsApp bot upgrades, design spec for the deferred work

This doc covers what *didn't* land in the phase-3 implementation pass:

1. **Per-user nudge-time pattern learning** (Pillar 3 in full)
2. **Voice-reply (TTS) outbound** (Pillar 4 — voice channel)
3. **Pact ops over chat** (Pillar 4 — accountability surface)
4. **Milestone updates over chat** (Pillar 4 — goal hierarchy)

Each section ends with **sign-off questions** for you. Nothing here is implemented yet — once we agree on the answers, I'll build.

---

## What already shipped in phase 3

For context, the completed work (this turn):

- Migration 032: `wa_conversation_context` rolling-window memory table (6 messages / ~3 turns by default).
- `lib/wa-conversation.ts`: read/write helpers, prompt-rendering formatter, schema-missing graceful degradation, retention-sweep at 14 days.
- `whatsapp-ai.ts`: parser accepts `recentMessages` and injects a `<RECENT_CONVERSATION>` block. New intent types: `multi_intent`, `clarify`, `add_goal`. `hardenIntent` validates all three.
- `webhook/route.ts`: reads memory once at the top, threads it through every parser call, records each user turn after parsing. Voice path participates in memory. New `executeIntent` cases for `multi_intent`, `clarify`, `add_goal`. New `handleAddGoal` writes to the `goals` table with sensible chat-creation defaults; the data-cap trigger from migration 029 still applies.
- Tests: 14 cases across `tests/lib/whatsapp-ai.test.ts` + `tests/lib/wa-conversation.test.ts`.

Visible upgrades from day one:
- Bot remembers the last few turns and resolves "the second one" / "yes that one".
- "Finish React then start Vue" works in one message.
- Destructive actions on ambiguous queries fall through to clarify instead of guessing.
- Goals can be created via chat: *"set a goal: ship MVP by 2026-09-30"*.

---

## 1. Per-user nudge-time pattern learning

**Today:** the coach cron fires hourly and uses fixed user-local hours per nudge type — morning kickoff at 8 AM local, midday check at 1 PM, evening wrap at 8 PM, etc. Same schedule for everyone, regardless of when they actually engage.

**Goal:** learn each user's actual engagement pattern and shift nudges toward the windows that get the highest reply-rate / completion-rate.

### Data we already have
- `coach_log` — every nudge sent, with `delivered: bool`, timestamp, nudge type, user_id.
- `wa_processed_messages` — every inbound message with phone + processed_at.
- `sessions` — pomodoro starts/completes; each carries `start_time` and `user_id`.
- `daily_tasks` — `completed_at` per task.

We can join `coach_log → wa_processed_messages` to compute per-user, per-nudge "did the user reply within 2 hours of receiving this nudge type?" That's the response signal; it doesn't require new instrumentation.

### Two candidate models

#### Option A — bandit per nudge type per user
Three or four candidate hour windows per nudge type (e.g., for `morning_kickoff`: 7 AM, 8 AM, 9 AM, 10 AM local). Each user × nudge has a separate Beta-Bernoulli bandit; we sample a window per cron run and update the posterior with the response signal.

Pros: simple to implement, well-understood theoretically, smoothly adapts to changes (user shifts work hours after a job change).
Cons: slow to converge (~30+ samples per arm to be confident); doesn't generalise across users or share information across nudge types.

#### Option B — shared logistic regression with user-level random effects
One model per nudge type predicting reply probability from features `(local_hour, weekday, days_since_signup, prior_streak, last_session_hours_ago, user_id_embedding)`. Refit nightly via the retention-sweep pipeline. Pick the hour with the highest predicted probability for each user, ties broken toward the existing fixed schedule.

Pros: fast warm-up (new users borrow strength from the global model); generalises across nudge types via shared features; easy to inspect (look at coefficients).
Cons: more code to maintain; needs a feature-engineering layer; cold-start handling for users with < 7 days of data.

### Recommended: Option A first, B if A's convergence is too slow
The bandit is one nightly cron + one row per user × nudge in a new table. We can ship it in 2-3 days and watch the convergence. If after 4 weeks we see users still getting stuck on suboptimal arms, swap to (B).

### New schema (sketch)

```sql
-- migration 033 (proposed)
CREATE TABLE nudge_arm_stats (
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nudge_type  TEXT NOT NULL,
  arm_hour    SMALLINT NOT NULL CHECK (arm_hour BETWEEN 0 AND 23),
  successes   INTEGER NOT NULL DEFAULT 0,
  failures    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, nudge_type, arm_hour)
);
```

Cron flow:
1. `cron/coach` selects an arm via Thompson sampling (`Beta(s+1, f+1).sample()`).
2. After 3 hours, a new `cron/coach-feedback` cron looks for replies / sessions in the 2-hour post-window and records the success/failure.

### Sign-off questions

1. **Bandit (A) or regression (B) first?** I recommend A for speed.
2. **A/B against fixed schedule, or full cutover?** I'd hold 20% of users on the fixed schedule for 4 weeks as control so we can measure lift.
3. **Quiet-hours interaction**: should the bandit's chosen hour always respect the user's `coaching_quiet_start/end` (mig 017)? My default is yes — quiet hours are an explicit user preference and the bandit shouldn't override.
4. **Nudge types in scope**: just `morning_kickoff`, `midday_checkin`, `evening_wrapup`? Or all 9 nudge types? I'd start with the three above — they have the most response data.

---

## 2. Voice-reply (TTS) outbound

**Today:** voice notes go IN (Whisper transcribes them), text-only goes OUT.

**Goal:** for the proactive Pro nudges (morning kickoff, weekly recap, streak saver), give users the option to receive voice replies — feels more personal, less like a notification.

### Provider trade-offs

| Provider | Quality | Latency | Cost / 1M chars | India-supported voices |
|---|---|---|---|---|
| ElevenLabs | Best | ~2-4 s | $90 (Multilingual v2) | Yes (Hindi + English) |
| OpenAI TTS-1 | Good | ~1-2 s | $15 | English only (well-tuned) |
| OpenAI TTS-1-HD | Better | ~2-3 s | $30 | English only |
| AWS Polly Neural | OK | ~1 s | $16 | Yes (Hindi, Tamil, Bengali) |

### Cost model
Average proactive nudge ≈ 200 chars. At 1000 Pro users × 9 nudge types × 200 chars = 1.8M chars/month per nudge type. Across all 9 nudge types: ~16M chars/month.

- ElevenLabs: ~$1,440/mo. Crosses ARPU territory fast.
- OpenAI TTS-1: ~$240/mo. Sustainable.
- AWS Polly: ~$256/mo. Sustainable + multilingual.

### Recommended: opt-in only, OpenAI TTS-1 by default, ElevenLabs as Pro+ upsell
- Add `coaching_voice_replies BOOLEAN DEFAULT false` to profiles (mig 034).
- Send voice in addition to text, not instead. The user gets both — they can ignore the voice if they're in a meeting.
- Cost cap per user: ~30 voice replies/month (covers daily kickoff + weekly recap with headroom). Track in `daily_anthropic_usage` analog or a separate `tts_usage` table.

### Implementation surface
1. New `lib/tts.ts`: provider-agnostic interface, returns audio buffer.
2. New `lib/whatsapp.ts` helper: `sendVoiceMessage(phone, audioBuffer)` — uploads to Meta's media endpoint, sends as audio message.
3. Coach cron: when `voice_replies=true`, render text → TTS → upload → send as audio (in parallel with the text send).
4. Quota: cap voice generations per user per day (default 10, Pro 30).

### Sign-off questions

1. **Default-on or opt-in?** Default-off feels safer (cost + user surprise); we can promote in onboarding.
2. **Provider**: OpenAI TTS-1 ($240/mo at scale) for English-only first, AWS Polly for Hindi/Tamil/Bengali later? Or pay for ElevenLabs and skip the multi-provider abstraction?
3. **Voice + text or voice instead of text?** Both is safer (user can read at a glance); voice-only saves bandwidth but is unsearchable.
4. **Inbound voice notes already exist via Whisper** — does that flow get any upgrades here, or stays as-is?

---

## 3. Pact ops over chat

**Today:** accountability pacts (mig 018, RLS hardened in mig 022) live entirely in the dashboard. Invite a friend by email → invite code → both see streak + activity. The proactive `pact-activity` cron emails partner summaries nightly.

**Goal:** pact CRUD over WhatsApp.

### New intents required

| Intent | Trigger phrasing | What it does |
|---|---|---|
| `pact_invite` | "invite Mudit to be my pact partner", "set up a pact with friend@…" | Creates pending pact + invite code. Texts the URL to the user. |
| `pact_accept` | "accept pact ABCD" or scanning a deep link | Binds the second user to the pact. |
| `pact_status` | "how's my partner doing", "pact stats" | Pulls the partner's streak + last 7 days. |
| `pact_end` | "end my pact", "remove my pact partner" | Terminates the pact. Confirmation step. |

### Surface area

- `whatsapp-ai.ts`: 4 new intent types in `WAIntent`, with prompt rules and `hardenIntent` cases (this is non-trivial — invite emails need email-format validation, codes need format validation).
- `webhook/route.ts`: 4 new handlers, ~50 lines each.
- API surface: existing `/api/pacts/{create,accept,end,partner-stats}` already exist; the chat handlers are mostly wrappers around those.

Confirmation step on `pact_end` would route through the existing `pendingFlow` infrastructure (mig: store flow type 'pact_end_confirm' with the pact_id; user replies "yes" to commit).

### Risk
The `pact_invite` flow lets a user send an outbound email via WhatsApp. That's a per-user spam risk — someone could grab a friend's WhatsApp and invite arbitrary email addresses to pacts they don't want. Already mitigated by:
- Light rate limit on `/api/pacts/create`.
- Email recipient gets an explicit consent step.
- All 4 actions log to `admin_audit` (TBD — needs a new action type).

### Sign-off questions

1. **All 4 intents or subset?** I'd ship `pact_status` first (read-only, no risk), then `pact_invite` once you've signed off on the email rate limit.
2. **Confirmation on `pact_end`**: yes via pending flow, or a click-button? WhatsApp Cloud API supports interactive button messages — using them here would be cleaner UX than a typed "yes".
3. **Phone-only pacts**: today pacts are email-keyed. Should chat invite require an email, or can it work with a partner's WhatsApp number directly? Phone-keyed would be a schema change.

---

## 4. Milestone updates over chat

**Today:** milestones are auto-generated when goals are created. They auto-complete when `sessions_completed` crosses the `session_target` (see `/api/sessions/complete`). User can edit them only via the dashboard.

**Goal:** add / rename / delete / mark milestones via chat.

### New intents

| Intent | Trigger | What it does |
|---|---|---|
| `add_milestone` | "add milestone: ship MVP at 50 sessions for the React goal" | Inserts a milestone tied to the named goal. |
| `list_milestones` | "milestones for X", "what milestones do I have" | Lists per-goal. |
| `complete_milestone` | "milestone done", "manually complete the MVP milestone" | Manual mark; auto-completion is handled by `/api/sessions/complete`. |

### Why this is the smallest pillar

The goal hierarchy is mostly auto-managed by `/api/sessions/complete` (it bumps `sessions_completed` and flips milestones once they hit `session_target`). User-triggered milestone changes are rare — most users either accept the auto-generated ones or edit them in the dashboard during goal creation.

I'd ship `list_milestones` as a fast win and defer the others until there's user demand.

### Sign-off questions

1. **Worth the surface area?** I'd argue no for `add_milestone` / `complete_milestone` until we see chat-driven demand. `list_milestones` alone is a 1-day add.
2. **Dependency on goal-name matching**: same fuzzy-match concerns as `complete_task`. Want to lean on the new `clarify` intent here?

---

## Recommended sequencing

If you sign off on all four pillars, I'd build them in this order:

1. **Pact `pact_status` (read-only, 1 day)** — validates the pattern, low risk.
2. **Bandit-based nudge timing (3 days)** — biggest UX lift; uses existing data.
3. **Voice replies (2 days)** — once bandit is converging, voice on the morning_kickoff is a wow moment.
4. **`add_milestone` + `list_milestones` (1 day)** — fills out the goal-hierarchy surface.
5. **Pact invite/accept/end (2 days)** — gated on email-rate-limit sign-off.

Total: ~9 days of focused work. Realistic to ship in 2-3 weeks alongside other priorities.

---

## What I need from you

- **Sign-offs on the 12 questions above**, or counter-proposals.
- **Priority order** if it differs from my recommendation.
- **Cost ceiling** for TTS so I can pick the provider with confidence.

Once those are in place, I'll create a follow-up phase 3.5 implementation plan and execute.
