import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { getAdminSupabase } from '@/lib/cron-helpers';
import { sendEmail, emailLayout, REPLY_TO } from '@/lib/email';
import { CRON_CATALOG, recordCronRun } from '@/lib/cron-run-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/cron/watchdog
 *
 * Hourly health-check on every other cron in CRON_CATALOG. For each
 * registered cron, we look up the most-recent `success` row in
 * cron_run_log; if it's older than the cron's `staleAfterMinutes`
 * threshold (or there's never been a success at all), we alert.
 *
 * Alerting:
 *   - One email per watchdog run, listing every stale cron in a single
 *     digest. We deliberately don't send a separate email per cron —
 *     a 5-cron outage at 3am should produce ONE email, not five.
 *   - Idempotent at the run level: if a cron is still stale on the next
 *     watchdog tick, we DO email again. The minor inbox noise is the
 *     correct trade for "operator can ignore for an hour and the alert
 *     keeps reminding them." A "snooze for N hours" mechanism would be
 *     a follow-up if alert fatigue ever becomes a real problem.
 *
 * The alert recipient is OPS_ALERT_EMAIL (env), falling back to
 * EMAIL_REPLY_TO. If neither is set we log the alert to console only —
 * the watchdog still records its own run so the watchdog of the
 * watchdog (you, manually) sees that this route fired.
 *
 * Scheduled hourly. Auth via standard CRON_SECRET bearer.
 */

interface StaleEntry {
  name: string;
  description: string;
  lastSuccess: string | null;
  ageMinutes: number | null;
  threshold: number;
}

export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  const supabase = getAdminSupabase();
  const now = Date.now();
  const stale: StaleEntry[] = [];

  // Single batched query: latest success per cron in CRON_CATALOG.
  // We pull the rows where status='success' and cron_name IN (catalog),
  // ordered by ran_at desc, then group client-side. With the
  // (cron_name, status, ran_at desc) index this is cheap.
  const names = CRON_CATALOG.map((c) => c.name);
  const { data: rows, error } = await supabase
    .from('cron_run_log')
    .select('cron_name, ran_at')
    .eq('status', 'success')
    .in('cron_name', names)
    .order('ran_at', { ascending: false });

  if (error) {
    console.error('[watchdog] query failed:', error);
    await recordCronRun('watchdog', 'failure', { reason: 'query_failed' });
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }

  const lastSuccessByName = new Map<string, string>();
  for (const r of rows ?? []) {
    if (!lastSuccessByName.has(r.cron_name)) {
      lastSuccessByName.set(r.cron_name, r.ran_at as string);
    }
  }

  for (const entry of CRON_CATALOG) {
    const lastSuccessIso = lastSuccessByName.get(entry.name) ?? null;
    if (!lastSuccessIso) {
      // Never recorded a success — warrants alert, but only after
      // we've actually had a chance to run. We use 2× the staleness
      // threshold as the "we expected a success by now" floor so a
      // freshly-deployed cron doesn't immediately page.
      const expectedBy = now - 2 * entry.staleAfterMinutes * 60 * 1000;
      if (expectedBy > 0 && now > expectedBy) {
        stale.push({
          name: entry.name,
          description: entry.description,
          lastSuccess: null,
          ageMinutes: null,
          threshold: entry.staleAfterMinutes,
        });
      }
      continue;
    }
    const ageMs = now - new Date(lastSuccessIso).getTime();
    const ageMinutes = Math.round(ageMs / 60000);
    if (ageMinutes > entry.staleAfterMinutes) {
      stale.push({
        name: entry.name,
        description: entry.description,
        lastSuccess: lastSuccessIso,
        ageMinutes,
        threshold: entry.staleAfterMinutes,
      });
    }
  }

  if (stale.length === 0) {
    await recordCronRun('watchdog', 'success', { stale_count: 0 });
    return NextResponse.json({ ok: true, healthy: true, checked: CRON_CATALOG.length });
  }

  // ── Compose + send the alert ─────────────────────────────────────
  const opsEmail = process.env.OPS_ALERT_EMAIL || REPLY_TO;
  if (!opsEmail) {
    console.error('[watchdog] STALE CRONS but no OPS_ALERT_EMAIL/REPLY_TO configured:', stale);
    await recordCronRun('watchdog', 'failure', { reason: 'no_recipient', stale_count: stale.length });
    return NextResponse.json({ ok: false, stale, alertSent: false });
  }

  const rowsHtml = stale
    .map((s) => {
      const ageStr = s.ageMinutes == null
        ? '<em>never recorded</em>'
        : s.ageMinutes < 60
        ? `${s.ageMinutes}m ago`
        : `${Math.round(s.ageMinutes / 60)}h ago`;
      return `<tr>
        <td style="padding:6px 12px 6px 0;font-size:13px;font-family:ui-monospace,monospace;color:#e2e8f0;">${s.name}</td>
        <td style="padding:6px 12px;font-size:13px;color:#94a3b8;">${s.description}</td>
        <td style="padding:6px 0 6px 12px;font-size:13px;color:#fca5a5;">${ageStr}</td>
      </tr>`;
    })
    .join('');

  let body = `<h1>Cron watchdog — ${stale.length} stale cron${stale.length === 1 ? '' : 's'}</h1>`;
  body += `<p>The watchdog detected ${stale.length} cron job${stale.length === 1 ? '' : 's'} that haven&rsquo;t logged a successful run within their tolerance window.</p>`;
  body += `<table style="width:100%;margin:16px 0;border-collapse:collapse;">
    <thead><tr style="text-align:left;border-bottom:1px solid rgba(255,255,255,0.1);">
      <th style="padding:6px 12px 6px 0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Cron</th>
      <th style="padding:6px 12px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Description</th>
      <th style="padding:6px 0 6px 12px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Last success</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
  body += `<p style="font-size:12px;color:#64748b;">First place to look: Vercel project → Functions → Cron tab. Then check the corresponding cron route&rsquo;s recent invocations for failures.</p>`;
  body += `<p style="font-size:11px;color:#475569;">This alert repeats every hour while the cron remains stale.</p>`;

  try {
    await sendEmail({
      to: opsEmail,
      subject: `[EffortOS] ${stale.length} stale cron${stale.length === 1 ? '' : 's'}`,
      html: emailLayout(body, { preheader: `Stale: ${stale.map(s => s.name).join(', ').slice(0, 80)}` }),
      transactional: true,
      tags: [{ name: 'type', value: 'watchdog' }],
    });
    await recordCronRun('watchdog', 'success', { stale_count: stale.length, names: stale.map(s => s.name) });
    return NextResponse.json({ ok: true, healthy: false, stale, alertSent: true });
  } catch (err) {
    console.error('[watchdog] alert send failed:', err);
    await recordCronRun('watchdog', 'failure', { reason: 'send_failed', stale_count: stale.length });
    return NextResponse.json({ ok: false, stale, alertSent: false }, { status: 500 });
  }
}
