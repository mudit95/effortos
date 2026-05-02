# Platform review — effortos-zeta.vercel.app

**Method:** signed-in DOM inspection via Claude in Chrome MCP, May 2 2026, dashboard tour as `Mudit (muditvns@gmail.com)`.

**Important caveat:** the deployed build is *behind* the most recent local commits (no streak-freeze CTA, no pause-subscription, no background picker, no goal-templates wizard, no pact-cancel button). So some findings below describe bugs your local code already fixes — flagged with `[FIXED LOCALLY]`. Others are genuinely outstanding.

What I could **not** test in this session: signup flow (account creation prohibited), WhatsApp link OTP (needs a phone), Razorpay checkout (needs test card), streak-freeze CTA (requires ≥3-day streak data), lapse-recovery modal (requires 7+ days dormant), most AI surfaces (cost tokens), mobile-responsive layout.

---

## CRITICAL — must-fix before public launch

### 1. Tab navigation is decorative, not functional [FIXED?]
- **Surfaces:** "Daily Grind" / "Long Term" / "Reports" / "New Goal" / "Meditate" buttons in the top nav.
- **Behaviour:** clicking any of them updates `document.title` (e.g., "Long Term — EffortOS") but the rendered DOM does **not change at all**. Body text stays at 742 chars across all three views; same headings (`May 2026 / Today / MOTIVATION / ERRANDS / TODAY AT A GLANCE`) appear regardless. Same for "New Goal" — clicking sets the title to "Set Your Goal — EffortOS" but no wizard or modal opens.
- **Impact:** users perceive the app as broken. They can't reach Long Term goals view, Reports, or the New Goal wizard at all from the top nav.
- **Likely root cause:** view state sets a flag that's bound to the `<title>` tag but the conditional rendering branch is missing or always falls back to the daily layout. Worth checking the `currentView` / `dashboardMode` switch in `Dashboard.tsx` — there's probably an `if (mode === 'daily')` that returns daily, with no other branches.
- **Severity:** P0 — blocks every flow that lives behind one of those tabs.

### 2. Pact pending invites can't be cancelled [FIXED LOCALLY]
- **Surface:** Settings → Pacts section.
- **Confirmed:** I see a pending invite row in the deployed Settings (`...ns@gmail.com / Waiting for them to accept / Code`) with no Cancel button. Matches the bug you originally reported.
- **Status in code:** my recent commit adds a Cancel button + age label. Just needs to deploy.

### 3. Subscription price missing currency symbol
- **Surface:** Settings → Subscription card.
- **Verbatim:** `Active subscription — 999/month` — no ₹ symbol, no `Rs`, nothing. Looks like a missing currency in the pricing display string.
- **Impact:** confusing for the user (is this ₹999, $999, or 999 of what?), and a chargeback risk if a paying customer screenshots this thinking they're being charged $999/mo.
- **Severity:** P1 — affects every Pro subscriber's settings view. Likely a `${PRO_PRICE_PER_MONTH}` substitution where the price constant is `999/month` instead of `₹999/month`.

---

## HIGH — accessibility / structural

### 4. Zero `<h1>` on the dashboard
- **Found:** `document.querySelectorAll('h1').length === 0`. Only one `<h2>` ("Today") + a few `<h3>`s.
- **Impact:** screen readers announce the page with no heading-level-1 anchor; "navigate by heading" key (`H` in JAWS/NVDA) skips the page entirely. Also a SEO weak signal.
- **Fix:** add an H1 to `Dashboard.tsx` — could be the active goal title, the user's name + date, or a visually-hidden "EffortOS dashboard" if no semantic candidate fits.

### 5. Top-nav lacks active-state signals (visual + a11y)
- **Found:** all three tabs (Daily Grind / Long Term / Reports) have **identical CSS classes** when active vs. inactive — no `bg-white/10`, no underline, no colour shift indicates which one is selected. Also no `aria-selected` or `aria-current` attribute on any of them.
- **Impact:** sighted users can't tell which view they're on (compounded by issue #1). Screen-reader users have zero "you are here" signal.
- **Fix:** when the view matches, add `aria-current="page"` and a visual treatment (the rest of the app already uses `text-cyan-400` for active state — match that pattern).

### 6. Settings opens as inline content without `role="dialog"`
- **Found:** clicking the Settings gear opens a panel (body text grows from 742 → 2956 chars) but `document.querySelectorAll('[role="dialog"]').length === 0`. No `aria-modal`. No focus trap. Pressing Escape may not close it (didn't test).
- **Impact:** keyboard users can tab out of the modal into the page underneath; screen-reader users hear the entire dashboard read out as if Settings were just inline content. Standard accessibility expectation for a modal is unmet.
- **Fix:** wrap `<SettingsModal>` in a Radix `Dialog` (already a project dependency) or add `role="dialog" aria-modal="true"` + a focus-trap library + Escape handler.

### 7. Two unlabelled icon buttons
- **Found:** of 59 buttons on the page, two have no `textContent`, `aria-label`, or `title`. Both 28×28 icon buttons in the same vertical strip (likely month nav arrows on the calendar).
- **Fix:** add `aria-label="Previous month"` / `aria-label="Next month"`.

### 8. Calendar weekday header reads "M T W T F S S"
- **Visible:** seven single letters as the calendar header.
- **Impact:** a screen reader announces "M, T, W, T, F, S, S" — Tuesday and Thursday are indistinguishable, Saturday and Sunday too. Sighted users figure it out from position, but the pattern fails accessibility regardless.
- **Fix:** use `aria-label="Tuesday"` on the cell (visual letter unchanged) — or use full names with abbreviated CSS rendering.

---

## MEDIUM — efficiency / hygiene

### 9. AI endpoints fire on every dashboard load
- **Found:** `/api/coach/motivation` and `/api/ai/daily-brief` both POST every time the dashboard renders.
- **Impact:** every page refresh, browser back-forward, deeplink-into-app, etc. burns Anthropic tokens. At 1k DAU × 5 visits/day × 1k tokens each = 5M tokens/day on motivation alone.
- **Fix:** cache the daily-brief response server-side keyed by `(user_id, date)` — only regenerate when the date changes or the user explicitly hits ⟳.

### 10. `/api/account/welcome-email` round-trips on every bootstrap
- **Found:** the route is intentionally idempotent — it checks `email_log` and bails out if a welcome was already sent. So no real spam, but…
- **Impact:** still a wasted round-trip on every page load. At scale, ~1k DAU = 1k unnecessary auth + DB hits per day, every day, forever.
- **Fix:** after the first 200, cache `welcomeSent: true` in `localStorage` and skip the call on subsequent bootstraps. Trust-but-verify periodically.

### 11. Empty-state copy is duplicated in two places
- **Found verbatim, top of dashboard:** `READY WHEN YOU ARE / Add tasks to start a session / IDLE / Start unassigned`
- **Found verbatim, middle of dashboard:** `Ready to start your day? / Add tasks, assign pomodoros, and work through them / Add your first task`
- **Impact:** the same message rendered twice in different visual styles. Reads like a UI bug; user may wonder which CTA is the "right" one.
- **Fix:** consolidate into one empty-state block with one CTA. The `IDLE` widget at the top can drop its instructional copy when the lower empty-state is showing.

### 12. Long Term + Reports have no empty-state for first-time users
- **Compounding #1:** even if the tab-switching bug were fixed, the Long Term and Reports views likely render blank for users with no goals/no sessions. Best practice: explicit "No goals yet — create one" copy with a CTA.

---

## LOW — polish / not-yet-deployed

### 13. Streak freeze CTA, pause-subscription, background picker, goal templates [FIXED LOCALLY]
- All four exist in `main` but aren't visible in the deployed Vercel build. After deploy:
  - Verify the Snowflake CTA appears under the streak count when tokens > 0 AND streak ≥ 3.
  - Verify the Pause/Cancel split appears in Settings → Subscription for active payers.
  - Verify the BackgroundPicker icon appears next to AmbientSoundToggle in Focus Mode.
  - Verify the goal templates appear on onboarding step 0.

### 14. No "Sign out" button found in Settings
- I scanned the open Settings panel for `/sign\s*out|log\s*out/i` — zero matches. May live in an account dropdown elsewhere (didn't find one in my tour). Worth confirming a logged-in user can actually sign out from the UI.

### 15. Document height vs. content mismatch
- **Found:** `document.documentElement.scrollHeight === 2154px` but `document.body.innerText.length === 742 chars`.
- **Impact:** lots of empty whitespace below the fold (1.4k px of vertical space with nothing rendered). Common cause: layout reserves space for sections that haven't loaded data yet, or a flex container with `min-height`.
- **Fix:** investigate — could be the Long Term/Reports area conditionally hiding its content (related to #1) but still consuming layout height.

---

## What I couldn't reach

These need separate runs once the deployment lag is closed and/or with realistic data:

| Surface | Blocker |
|---|---|
| Sign-up flow | Account creation prohibited by my system prompt |
| Onboarding wizard | Couldn't trigger ("New Goal" click was a no-op — issue #1) |
| Goal templates UI | Same as above |
| Focus Mode + ambient sounds + background picker | Couldn't navigate via the broken nav |
| Streak calendar interaction | Calendar visible but couldn't drill into a date |
| Streak freeze CTA | No streak data to qualify |
| Lapse-recovery modal | Need user dormant 7+ days |
| Welcome-back email | Need user dormant 7+ days |
| Razorpay checkout | Needs test card on the live site |
| WhatsApp link / OTP | Needs phone interaction |
| Mobile responsive | Didn't resize the viewport |
| Dark/light theme switch | Didn't toggle it |
| Account export / delete | Didn't trigger destructive flow on a real account |
| Pact accept flow | Needs an invite from a partner |
| Email cron output | Server-side, can't observe from browser |

---

## Recommended fix order

1. **Fix #1 (tab nav rendering)** — it gates almost everything else. Without this, users can't reach half the app.
2. **Deploy** — cleanly closes #2, #13, and surfaces whatever else my local commits have improved.
3. **Fix #3 (currency symbol)** — touches every paying user's settings view.
4. **Fix #6 (Settings as proper modal)** — accessibility + keyboard escape + focus trap.
5. **Fix #4, #5, #7, #8** in one a11y sweep — they're small individually but compound.
6. **Cache fixes #9 + #10** to stop bleeding tokens + round-trips.
7. **Re-test** with this same DOM-inspection method after the above land.

I can drive a follow-up review after deploy if you want — cleaner DOM, more surfaces reachable, fewer "[FIXED LOCALLY]" footnotes muddying the picture.
