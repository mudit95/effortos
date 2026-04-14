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
