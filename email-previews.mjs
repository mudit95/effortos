// Quick script to generate preview HTML files for all 3 email templates
import { writeFileSync } from 'fs';

// Inline the template logic since we can't easily import TS modules
const APP_URL = 'https://effortos.app';

function emailLayout(body, opts = {}) {
  const preheader = opts.preheader || '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EffortOS</title>
  <style>
    body { margin: 0; padding: 0; background: #0B0F14; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 560px; margin: 0 auto; padding: 40px 24px; }
    .logo { font-size: 13px; font-weight: 700; color: #06b6d4; letter-spacing: 0.5px; margin-bottom: 28px; }
    h1 { color: #f1f5f9; font-size: 20px; font-weight: 600; margin: 0 0 12px; }
    h2 { color: #e2e8f0; font-size: 16px; font-weight: 600; margin: 24px 0 8px; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 12px; }
    .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 16px; margin: 16px 0; }
    .stat { display: inline-block; text-align: center; margin-right: 24px; }
    .stat-value { font-size: 22px; font-weight: 700; color: #06b6d4; }
    .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
    .task { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); color: #cbd5e1; font-size: 13px; }
    .task:last-child { border-bottom: none; }
    .task-done { text-decoration: line-through; color: #475569; }
    .tag { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 9999px; background: rgba(6,182,212,0.15); color: #06b6d4; margin-left: 8px; }
    .btn { display: inline-block; background: #06b6d4; color: #0f172a; font-size: 14px; font-weight: 600; text-decoration: none; padding: 10px 24px; border-radius: 8px; margin: 16px 0; }
    .btn:hover { background: #22d3ee; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.06); }
    .footer p { font-size: 11px; color: #475569; }
    .footer a { color: #06b6d4; text-decoration: none; }
    .preheader { display: none; font-size: 1px; color: #0B0F14; line-height: 1px; max-height: 0; max-width: 0; opacity: 0; overflow: hidden; }
  </style>
</head>
<body>
  <div class="preheader">${preheader}</div>
  <div class="container">
    <div class="logo">EFFORTOS</div>
    ${body}
    <div class="footer">
      <p>You received this because you have an EffortOS account. <a href="${APP_URL}/settings">Manage email preferences</a> or <a href="${APP_URL}/unsubscribe">unsubscribe</a>.</p>
    </div>
  </div>
</body>
</html>`;
}

function taskRow(title, done, pomsDone, pomsTarget, tag) {
  const cls = done ? 'task task-done' : 'task';
  const tagHtml = tag ? `<span class="tag">${tag}</span>` : '';
  const progress = pomsTarget > 0 ? ` (${pomsDone}/${pomsTarget} poms)` : '';
  return `<div class="${cls}">${done ? '✓' : '○'} ${title}${progress}${tagHtml}</div>`;
}

// ── MORNING EMAIL ─────────────────────────────────────────────────

const morningTasks = [
  { title: 'Complete React auth module', completed: true, pd: 3, pt: 3, goal: 'Learn React' },
  { title: 'Write unit tests for API', completed: false, pd: 1, pt: 4, goal: 'Learn React' },
  { title: 'Read chapter 8 of Clean Code', completed: true, pd: 2, pt: 2, goal: null },
  { title: 'Review PR #42', completed: false, pd: 0, pt: 1, tag: 'admin' },
  { title: 'Update project README', completed: true, pd: 1, pt: 1, tag: 'writing' },
];

let morningBody = `<h1>Good morning, Mudit</h1>`;
morningBody += `<p>Happy Tuesday. Time to set your focus for today.</p>`;
morningBody += `<h2>Yesterday&rsquo;s recap</h2>`;
morningBody += `<p>3 of 5 tasks completed.</p>`;

const goalTasks = morningTasks.filter(t => t.goal);
const dailyTasks = morningTasks.filter(t => !t.goal);

morningBody += `<div class="card"><p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Long-term goals</p>`;
goalTasks.forEach(t => { morningBody += taskRow(t.title, t.completed, t.pd, t.pt, t.goal); });
morningBody += `</div>`;

morningBody += `<div class="card"><p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Daily grind</p>`;
dailyTasks.forEach(t => { morningBody += taskRow(t.title, t.completed, t.pd, t.pt, t.tag); });
morningBody += `</div>`;

morningBody += `<p style="color:#f59e0b;">⚡ 2 tasks carried over. Want to tackle them today?</p>`;

morningBody += `<div class="card">`;
morningBody += `<p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Goal: Learn React & Next.js</p>`;
morningBody += `<div class="stat"><span class="stat-value">62%</span><br/><span class="stat-label">Progress</span></div>`;
morningBody += `<div class="stat"><span class="stat-value">17</span><br/><span class="stat-label">Day streak</span></div>`;
morningBody += `<div class="stat"><span class="stat-value">23</span><br/><span class="stat-label">Sessions left</span></div>`;
morningBody += `</div>`;

morningBody += `<a href="${APP_URL}/dashboard" class="btn">Plan your day &rarr;</a>`;

writeFileSync('/sessions/inspiring-sharp-einstein/preview-morning.html',
  emailLayout(morningBody, { preheader: '3 of 5 tasks completed yesterday' }));

// ── AFTERNOON EMAIL ───────────────────────────────────────────────

const afternoonTasks = [
  { title: 'Write unit tests for API', completed: true, pd: 4, pt: 4, tag: null, goal: 'Learn React' },
  { title: 'Review PR #42', completed: true, pd: 1, pt: 1, tag: 'admin' },
  { title: 'Build dashboard layout', completed: false, pd: 1, pt: 3, tag: null, goal: 'Learn React' },
  { title: 'Prep for standup', completed: false, pd: 0, pt: 1, tag: 'meetings' },
];

let afternoonBody = `<h1>Afternoon check-in</h1>`;
afternoonBody += `<p>Nice work so far, Mudit! You&rsquo;ve done 5 sessions (125 min of focus).</p>`;

afternoonBody += `<div class="card">`;
afternoonBody += `<p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Today&rsquo;s tasks (2/4)</p>`;
afternoonTasks.forEach(t => { afternoonBody += taskRow(t.title, t.completed, t.pd, t.pt, t.tag || t.goal); });
afternoonBody += `</div>`;

afternoonBody += `<p>2 tasks still open. You&rsquo;ve got this.</p>`;
afternoonBody += `<a href="${APP_URL}/dashboard" class="btn">Open EffortOS &rarr;</a>`;

writeFileSync('/sessions/inspiring-sharp-einstein/preview-afternoon.html',
  emailLayout(afternoonBody, { preheader: '2 of 4 tasks done so far' }));

// ── NIGHTLY EMAIL ─────────────────────────────────────────────────

let nightlyBody = `<h1>Day&rsquo;s wrap-up</h1>`;
nightlyBody += `<p>Here&rsquo;s how today went, Mudit.</p>`;

nightlyBody += `<div class="card" style="text-align:center;">`;
nightlyBody += `<div class="stat"><span class="stat-value">7</span><br/><span class="stat-label">Sessions</span></div>`;
nightlyBody += `<div class="stat"><span class="stat-value">175m</span><br/><span class="stat-label">Focus time</span></div>`;
nightlyBody += `<div class="stat"><span class="stat-value">3/4</span><br/><span class="stat-label">Tasks done</span></div>`;
nightlyBody += `<div class="stat"><span class="stat-value">18</span><br/><span class="stat-label">Streak</span></div>`;
nightlyBody += `</div>`;

nightlyBody += `<h2>Task summary</h2>`;
nightlyBody += `<div class="card">`;
const nightlyTasks = [
  { title: 'Write unit tests for API', completed: true, pd: 4, pt: 4, goal: 'Learn React' },
  { title: 'Review PR #42', completed: true, pd: 1, pt: 1, tag: 'admin' },
  { title: 'Build dashboard layout', completed: true, pd: 3, pt: 3, goal: 'Learn React' },
  { title: 'Prep for standup', completed: false, pd: 0, pt: 1, tag: 'meetings' },
];
nightlyTasks.forEach(t => { nightlyBody += taskRow(t.title, t.completed, t.pd, t.pt, t.tag || t.goal); });
nightlyBody += `</div>`;

nightlyBody += `<div class="card">`;
nightlyBody += `<p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Learn React & Next.js</p>`;
nightlyBody += `<p>Overall progress: <strong style="color:#06b6d4;">68%</strong> (41/60 sessions)</p>`;
nightlyBody += `</div>`;

nightlyBody += `<p>📋 1 task will carry over to Wednesday. Set your plan tonight to hit the ground running.</p>`;
nightlyBody += `<a href="${APP_URL}/dashboard" class="btn">Plan tomorrow &rarr;</a>`;

writeFileSync('/sessions/inspiring-sharp-einstein/preview-nightly.html',
  emailLayout(nightlyBody, { preheader: '175 min focused, 3 tasks complete' }));

console.log('Generated: preview-morning.html, preview-afternoon.html, preview-nightly.html');
