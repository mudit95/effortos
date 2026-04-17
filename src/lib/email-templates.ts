import { emailLayout, APP_URL } from './email';

// ── Helper ────────────────────────────────────────────────────────

function taskRow(title: string, done: boolean, pomsDone: number, pomsTarget: number, tag?: string): string {
  const cls = done ? 'task task-done' : 'task';
  const tagHtml = tag ? `<span class="tag">${tag}</span>` : '';
  const progress = pomsTarget > 0 ? ` (${pomsDone}/${pomsTarget} poms)` : '';
  return `<div class="${cls}">${done ? '✓' : '○'} ${title}${progress}${tagHtml}</div>`;
}

// ── Types ─────────────────────────────────────────────────────────

export interface TaskSummary {
  title: string;
  completed: boolean;
  pomodoros_done: number;
  pomodoros_target: number;
  tag?: string;
  goal_title?: string; // if linked to a long-term goal
}

export interface GoalSummary {
  title: string;
  sessions_completed: number;
  estimated_sessions: number;
  streak: number;
}

export interface DaySummary {
  total_sessions: number;
  total_focus_minutes: number;
  tasks_completed: number;
  tasks_total: number;
  streak: number;
}

// ── Morning Email ─────────────────────────────────────────────────

export function morningEmail(opts: {
  userName: string;
  yesterdayTasks: TaskSummary[];
  activeGoal?: GoalSummary;
  dayOfWeek: string;
}): { subject: string; html: string } {
  const { userName, yesterdayTasks, activeGoal, dayOfWeek } = opts;
  const firstName = userName.split(' ')[0];

  const hasYesterdayTasks = yesterdayTasks.length > 0;
  const completedCount = yesterdayTasks.filter(t => t.completed).length;
  const goalTasks = yesterdayTasks.filter(t => t.goal_title);
  const dailyTasks = yesterdayTasks.filter(t => !t.goal_title);

  let body = `<h1>Good morning, ${firstName}</h1>`;
  body += `<p>Happy ${dayOfWeek}. Time to set your focus for today.</p>`;

  // Yesterday recap
  if (hasYesterdayTasks) {
    body += `<h2>Yesterday&rsquo;s recap</h2>`;
    body += `<p>${completedCount} of ${yesterdayTasks.length} tasks completed.</p>`;

    if (goalTasks.length > 0) {
      body += `<div class="card"><p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Long-term goals</p>`;
      goalTasks.forEach(t => { body += taskRow(t.title, t.completed, t.pomodoros_done, t.pomodoros_target, t.goal_title); });
      body += `</div>`;
    }
    if (dailyTasks.length > 0) {
      body += `<div class="card"><p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Daily grind</p>`;
      dailyTasks.forEach(t => { body += taskRow(t.title, t.completed, t.pomodoros_done, t.pomodoros_target, t.tag); });
      body += `</div>`;
    }

    // Carry-forward nudge
    const incomplete = yesterdayTasks.filter(t => !t.completed);
    if (incomplete.length > 0) {
      body += `<p style="color:#f59e0b;">⚡ ${incomplete.length} task${incomplete.length > 1 ? 's' : ''} carried over. Want to tackle ${incomplete.length === 1 ? 'it' : 'them'} today?</p>`;
    }
  } else {
    body += `<p>No tasks were set yesterday. Let&rsquo;s change that today.</p>`;
  }

  // Active goal progress
  if (activeGoal) {
    const pct = activeGoal.estimated_sessions > 0
      ? Math.round((activeGoal.sessions_completed / activeGoal.estimated_sessions) * 100)
      : 0;
    body += `<div class="card">`;
    body += `<p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Goal: ${activeGoal.title}</p>`;
    body += `<div class="stat"><span class="stat-value">${pct}%</span><br/><span class="stat-label">Progress</span></div>`;
    body += `<div class="stat"><span class="stat-value">${activeGoal.streak}</span><br/><span class="stat-label">Day streak</span></div>`;
    body += `<div class="stat"><span class="stat-value">${activeGoal.estimated_sessions - activeGoal.sessions_completed}</span><br/><span class="stat-label">Sessions left</span></div>`;
    body += `</div>`;
  }

  body += `<a href="${APP_URL}/dashboard" class="btn">Plan your day &rarr;</a>`;

  return {
    subject: hasYesterdayTasks
      ? `${completedCount}/${yesterdayTasks.length} done yesterday — plan today's focus`
      : `Good morning ${firstName} — set your focus for today`,
    html: emailLayout(body, { preheader: hasYesterdayTasks ? `${completedCount} of ${yesterdayTasks.length} tasks completed yesterday` : 'Time to plan your day' }),
  };
}

// ── Afternoon Email ───────────────────────────────────────────────

export function afternoonEmail(opts: {
  userName: string;
  todayTasks: TaskSummary[];
  sessionsToday: number;
  focusMinutesToday: number;
}): { subject: string; html: string } {
  const { userName, todayTasks, sessionsToday, focusMinutesToday } = opts;
  const firstName = userName.split(' ')[0];
  const completedCount = todayTasks.filter(t => t.completed).length;
  const remaining = todayTasks.filter(t => !t.completed);

  let body = `<h1>Afternoon check-in</h1>`;

  if (sessionsToday > 0) {
    body += `<p>Nice work so far, ${firstName}! You&rsquo;ve done ${sessionsToday} session${sessionsToday > 1 ? 's' : ''} (${focusMinutesToday} min of focus).</p>`;
  } else {
    body += `<p>Hey ${firstName}, you haven&rsquo;t started any sessions yet today. There&rsquo;s still time.</p>`;
  }

  if (todayTasks.length > 0) {
    body += `<div class="card">`;
    body += `<p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Today&rsquo;s tasks (${completedCount}/${todayTasks.length})</p>`;
    todayTasks.forEach(t => { body += taskRow(t.title, t.completed, t.pomodoros_done, t.pomodoros_target, t.tag || t.goal_title); });
    body += `</div>`;

    if (remaining.length > 0) {
      body += `<p>${remaining.length} task${remaining.length > 1 ? 's' : ''} still open. You&rsquo;ve got this.</p>`;
    } else {
      body += `<p>🎉 All tasks done! Impressive. Consider adding a stretch task or wrapping up early — you&rsquo;ve earned it.</p>`;
    }
  } else {
    body += `<p>No tasks set today. Quick, set one and knock it out before end of day.</p>`;
  }

  body += `<a href="${APP_URL}/dashboard" class="btn">Open EffortOS &rarr;</a>`;

  return {
    subject: sessionsToday > 0
      ? `${sessionsToday} session${sessionsToday > 1 ? 's' : ''} done — ${remaining.length} task${remaining.length !== 1 ? 's' : ''} left`
      : `Afternoon nudge — still time to get a session in`,
    html: emailLayout(body, { preheader: `${completedCount} of ${todayTasks.length} tasks done so far` }),
  };
}

// ── Nightly Email ─────────────────────────────────────────────────

export function nightlyEmail(opts: {
  userName: string;
  todayTasks: TaskSummary[];
  daySummary: DaySummary;
  activeGoal?: GoalSummary;
  tomorrowDay: string;
}): { subject: string; html: string } {
  const { userName, todayTasks, daySummary, activeGoal, tomorrowDay } = opts;
  const firstName = userName.split(' ')[0];

  let body = `<h1>Day&rsquo;s wrap-up</h1>`;
  body += `<p>Here&rsquo;s how today went, ${firstName}.</p>`;

  // Stats row
  body += `<div class="card" style="text-align:center;">`;
  body += `<div class="stat"><span class="stat-value">${daySummary.total_sessions}</span><br/><span class="stat-label">Sessions</span></div>`;
  body += `<div class="stat"><span class="stat-value">${daySummary.total_focus_minutes}m</span><br/><span class="stat-label">Focus time</span></div>`;
  body += `<div class="stat"><span class="stat-value">${daySummary.tasks_completed}/${daySummary.tasks_total}</span><br/><span class="stat-label">Tasks done</span></div>`;
  body += `<div class="stat"><span class="stat-value">${daySummary.streak}</span><br/><span class="stat-label">Streak</span></div>`;
  body += `</div>`;

  // Task breakdown
  if (todayTasks.length > 0) {
    body += `<h2>Task summary</h2>`;
    body += `<div class="card">`;
    todayTasks.forEach(t => { body += taskRow(t.title, t.completed, t.pomodoros_done, t.pomodoros_target, t.tag || t.goal_title); });
    body += `</div>`;
  }

  // Goal progress
  if (activeGoal) {
    const pct = activeGoal.estimated_sessions > 0
      ? Math.round((activeGoal.sessions_completed / activeGoal.estimated_sessions) * 100)
      : 0;
    body += `<div class="card">`;
    body += `<p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">${activeGoal.title}</p>`;
    body += `<p>Overall progress: <strong style="color:#06b6d4;">${pct}%</strong> (${activeGoal.sessions_completed}/${activeGoal.estimated_sessions} sessions)</p>`;
    body += `</div>`;
  }

  // Tomorrow nudge
  const incomplete = todayTasks.filter(t => !t.completed);
  if (incomplete.length > 0) {
    body += `<p>📋 ${incomplete.length} task${incomplete.length > 1 ? 's' : ''} will carry over to ${tomorrowDay}. Set your plan tonight to hit the ground running.</p>`;
  } else if (daySummary.total_sessions > 0) {
    body += `<p>Clean sweep today! Set up ${tomorrowDay}&rsquo;s tasks before you sign off.</p>`;
  } else {
    body += `<p>Tomorrow&rsquo;s a fresh start. Take a minute to set your tasks for ${tomorrowDay}.</p>`;
  }

  body += `<a href="${APP_URL}/dashboard" class="btn">Plan tomorrow &rarr;</a>`;

  return {
    subject: daySummary.total_sessions > 0
      ? `Day done: ${daySummary.total_sessions} sessions, ${daySummary.tasks_completed}/${daySummary.tasks_total} tasks ✓`
      : `Day wrap-up — plan tomorrow's focus now`,
    html: emailLayout(body, { preheader: `${daySummary.total_focus_minutes} min focused, ${daySummary.tasks_completed} tasks complete` }),
  };
}

// ── Welcome email (sent once on first signup) ─────────────────────

/**
 * Welcome email for newly-created accounts.
 * Keep it short: orient, set expectations, give them one first action.
 */
export function welcomeEmail(opts: { userName: string }): { subject: string; html: string } {
  const firstName = (opts.userName || 'there').split(' ')[0];

  let body = `<h1>Welcome to EffortOS, ${firstName} 👋</h1>`;
  body += `<p>You just joined the crew of people who actually know where their hours go. Here&rsquo;s the short version of what EffortOS does:</p>`;

  body += `<div class="card">`;
  body += `<p><strong style="color:#e2e8f0;">1. Timebox with Pomodoros.</strong> Pick a task, start a 25-minute session, stay off everything else.</p>`;
  body += `<p><strong style="color:#e2e8f0;">2. Set long-term goals.</strong> Break them into milestones and rack up sessions against them.</p>`;
  body += `<p><strong style="color:#e2e8f0;">3. Let the AI coach reflect with you.</strong> Plan-your-day, session debriefs, weekly insights — premium unlocks these.</p>`;
  body += `</div>`;

  body += `<h2>Your first 10 minutes</h2>`;
  body += `<p>Open the app, add one task you&rsquo;ve been avoiding, and run a single Pomodoro. That&rsquo;s it. The habit loop starts from there.</p>`;

  body += `<a href="${APP_URL}/dashboard" class="btn">Open EffortOS &rarr;</a>`;

  body += `<p style="margin-top:24px;color:#64748b;font-size:12px;">Replies land in my inbox — hit reply if anything&rsquo;s broken, confusing, or missing. &mdash; Mudit</p>`;

  return {
    subject: `Welcome to EffortOS, ${firstName}`,
    html: emailLayout(body, { preheader: 'The 10-minute getting-started on knowing where your hours actually go.' }),
  };
}

// ── Trial-ending email (sent ~24h before first charge) ────────────

/**
 * Sent to users whose 3-day free trial ends within the next ~24 hours.
 * Purpose: tell them the charge is coming, give them a clean out if they
 * don't want to continue, and remind them what they unlock if they stay.
 */
export function trialEndingEmail(opts: {
  userName: string;
  trialEndsAt: Date; // current_period_end of the trialing subscription
  amountLabel?: string; // e.g., "₹499/month" — defaults to that
}): { subject: string; html: string } {
  const firstName = (opts.userName || 'there').split(' ')[0];
  const amountLabel = opts.amountLabel || '\u20B9499/month';

  // Human date in user's locale (approx — sent UTC, rendered by mail client).
  const when = opts.trialEndsAt.toLocaleDateString('en-IN', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  let body = `<h1>Your free trial wraps up soon</h1>`;
  body += `<p>Heads up, ${firstName} — your 3-day EffortOS trial ends on <strong style="color:#e2e8f0;">${when}</strong>. After that your card will be charged ${amountLabel} to keep your premium access running.</p>`;

  body += `<h2>What premium keeps unlocked</h2>`;
  body += `<div class="card">`;
  body += `<p>• <strong style="color:#e2e8f0;">AI coach</strong> — plan-your-day, session debriefs, weekly insights</p>`;
  body += `<p>• <strong style="color:#e2e8f0;">Unlimited long-term goals</strong> with milestone tracking</p>`;
  body += `<p>• <strong style="color:#e2e8f0;">Daily, afternoon and nightly email digests</strong></p>`;
  body += `<p>• <strong style="color:#e2e8f0;">WhatsApp check-ins</strong> (beta)</p>`;
  body += `</div>`;

  body += `<p>If that sounds right, you don&rsquo;t need to do anything — billing continues automatically.</p>`;
  body += `<p>Not for you? No hard feelings. You can cancel any time before the charge from Settings, and you&rsquo;ll keep access until the trial actually ends.</p>`;

  body += `<a href="${APP_URL}/settings" class="btn">Manage subscription &rarr;</a>`;

  return {
    subject: `Your EffortOS trial ends ${when}`,
    html: emailLayout(body, { preheader: `First charge of ${amountLabel} on ${when}. Cancel any time in Settings.` }),
  };
}

// ── Payment-failed email (sent when card decline puts sub in past_due) ─

/**
 * Sent when Razorpay reports a failed/declined recurring payment.
 * Tells the user their access is at risk, gives them a clear recovery
 * path, and sets expectations about retries.
 */
export function paymentFailedEmail(opts: {
  userName: string;
  subscriptionShortUrl?: string | null; // Razorpay-hosted update page
  isHalted?: boolean; // true if retries are exhausted
}): { subject: string; html: string } {
  const firstName = (opts.userName || 'there').split(' ')[0];
  const { subscriptionShortUrl, isHalted } = opts;

  let body = `<h1>We couldn&rsquo;t process your payment</h1>`;
  body += `<p>Hey ${firstName} — your last EffortOS payment didn&rsquo;t go through. The most common cause is an expired card, an insufficient balance, or an OTP that wasn&rsquo;t completed in time.</p>`;

  if (isHalted) {
    body += `<div class="card" style="border-color:rgba(239,68,68,0.3);">`;
    body += `<p style="color:#fca5a5;"><strong>Razorpay has stopped retrying.</strong> To keep your premium access, please update your payment method now — once we get a successful charge, everything resumes exactly where it left off. Your goals, sessions, and history are untouched.</p>`;
    body += `</div>`;
  } else {
    body += `<p>We&rsquo;ll automatically retry the charge over the next few days. Premium features are paused until a retry succeeds, but your data is safe.</p>`;
  }

  body += `<h2>Fastest fix</h2>`;
  body += `<p>Open your subscription in Razorpay and update the card on file:</p>`;

  if (subscriptionShortUrl) {
    body += `<a href="${subscriptionShortUrl}" class="btn">Update payment method &rarr;</a>`;
  } else {
    body += `<a href="${APP_URL}/settings" class="btn">Open subscription settings &rarr;</a>`;
  }

  body += `<p style="margin-top:16px;color:#64748b;font-size:12px;">If this looks wrong, reply to this email — we&rsquo;ll sort it out.</p>`;

  return {
    subject: isHalted
      ? `Action required: update your EffortOS payment method`
      : `Your EffortOS payment failed — we'll retry`,
    html: emailLayout(body, { preheader: isHalted ? 'Retries exhausted. Update your card to keep premium access.' : 'We will retry automatically. Update your card if the issue persists.' }),
  };
}

// ── Admin custom email ────────────────────────────────────────────

export function adminCustomEmail(opts: {
  subject: string;
  body: string; // markdown-ish: \n\n for paragraphs, supports basic HTML
  ctaText?: string;
  ctaUrl?: string;
}): string {
  const { body: rawBody, ctaText, ctaUrl } = opts;

  const paragraphs = rawBody
    .split(/\n\n+/)
    .map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');

  let html = paragraphs;
  if (ctaText && ctaUrl) {
    html += `<a href="${ctaUrl}" class="btn">${ctaText}</a>`;
  }

  return emailLayout(html);
}
