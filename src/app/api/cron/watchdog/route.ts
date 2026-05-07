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
 *   - Per-cron debounce: if the SAME cron was reported stale within
 *     the last ALERT_DEBOUNCE_HOURS, we drop it from this run's
 *     digest. The previous behaviour ("email every hour while still
 *     stale") generated ~168 alerts/week for a single broken cron and
 *     was the source of "stale cron notification" inbox noise users
 *     reported. Persistently-stale crons now generate ~2/day; genuine
 *     new outages still alert immediately because there's no prior
 *     watchdog row to debounce against.
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

/** How long to suppress repeat alerts about the same stale cron.
 *  12 h means a persistently broken cron alerts ~2×/day instead of
 *  ~24×/day. Tunable; this is the minimum gap that still feels alive. */
const ALERT_DEBOUNCE_HOURS = 12;

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

  // ── Per-cron debounce ─────────────────────────────────────────────
  // Look at our own prior watchdog runs in the last ALERT_DEBOUNCE_HOURS
  // and pull out which cron names we've already complained about. If a
  // currently-stale cron appears in that set, drop it from THIS digest
  // — we already alerted recently, no point re-sending. We still record
  // the run with the full stale list so the accumulating audit trail
  // is accurate; we just suppress the email.
  const debounceCutoff = new Date(now - ALERT_DEBOUNCE_HOURS * 60 * 60 * 1000).toISOString();
  const { data: priorAlerts } = await supabase
    .from('cron_run_log')
    .select('details, ran_at')
    .eq('cron_name', 'watchdog')
    .eq('status', 'success')
    .gte('ran_at', debounceCutoff)
    .order('ran_at', { ascending: false })
    .limit(50);

  const recentlyAlertedNames = new Set<string>();
  for (const row of priorAlerts ?? []) {
    const details = (row as { details?: { names?: unknown } }).details;
    const priorNames = details?.names;
    if (Array.isArray(priorNames)) {
      for (const n of priorNames) {
        if (typeof n === 'string') recentlyAlertedNames.add(n);
      }
    }
  }

  const freshStale = stale.filter((s) => !recentlyAlertedNames.has(s.name));

  if (freshStale.length === 0) {
    // Everything still-stale was already alerted within the debounce
    // window. Record the run so the audit trail shows the watchdog
    // ran healthily, but DO NOT include `names` in the result — only
    // alert-sending runs should populate names, otherwise the debounce
    // filter (which scans for prior names) would refresh itself every
    // hour and never let the next alert through.
    await recordCronRun('watchdog', 'success', {
      stale_count: stale.length,
      suppressed_count: stale.length,
      reason: 'debounced',
      suppressed_names: stale.map((s) => s.name),
    });
    return NextResponse.json({
      ok: true,
      healthy: false,
      stale,
      alertSent: false,
      suppressed: 'debounced',
    });
  }

  // ── Compose + send the alert ─────────────────────────────────────
  const opsEmail = process.env.OPS_ALERT_EMAIL || REPLY_TO;
  if (!opsEmail) {
    console.error('[watchdog] STALE CRONS but no OPS_ALERT_EMAIL/REPLY_TO configured:', freshStale);
    await recordCronRun('watchdog', 'failure', { reason: 'no_recipient', stale_count: freshStale.length });
    return NextResponse.json({ ok: false, stale: freshStale, alertSent: false });
  }

  const rowsHtml = freshStale
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

  const suppressedCount = stale.length - freshStale.length;

  let body = `<h1>Cron watchdog — ${freshStale.length} stale cron${freshStale.length === 1 ? '' : 's'}</h1>`;
  body += `<p>The watchdog detected ${freshStale.length} cron job${freshStale.length === 1 ? '' : 's'} that haven't logged a successful run within their tolerance window.</p>`;
  body += `<table style="width:100%;margin:16px 0;border-collapse:collapse;">
    <thead><tr style="text-align:left;border-bottom:1px solid rgba(255,255,255,0.1);">
      <th style="padding:6px 12px 6px 0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Cron</th>
      <th style="padding:6px 12px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Description</th>
      <th style="padding:6px 0 6px 12px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Last success</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
  body += `<p style="font-size:12px;color:#64748b;">First place to look: Vercel project → Functions → Cron tab. Then check the corresponding cron route's recent invocations for failures.</p>`;
  if (suppressedCount > 0) {
    body += `<p style="font-size:11px;color:#475569;">${suppressedCount} other stale cron${suppressedCount === 1 ? '' : 's'} suppressed — already alerted within the last ${ALERT_DEBOUNCE_HOURS}h.</p>`;
  }
  body += `<p style="font-size:11px;color:#475569;">Repeat alerts for the same cron are debounced for ${ALERT_DEBOUNCE_HOURS}h to keep this inbox quiet.</p>`;

  try {
    await sendEmail({
      to: opsEmail,
      subject: `[EffortOS] ${freshStale.length} stale cron${freshStale.length === 1 ? '' : 's'}`,
      html: emailLayout(body, { preheader: `Stale: ${freshStale.map(s => s.name).join(', ').slice(0, 80)}` }),
      transactional: true,
      tags: [{ name: 'type', value: 'watchdog' }],
    });
    await recordCronRun('watchdog', 'success', {
      stale_count: stale.length,
      alerted_count: freshStale.length,
      suppressed_count: suppressedCount,
      names: freshStale.map((s) => s.name),
    });
    return NextResponse.json({ ok: true, healthy: false, stale: freshStale, alertSent: true });
  } catch (err) {
    console.error('[watchdog] alert send failed:', err);
    await recordCronRun('watchdog', 'failure', { reason: 'send_failed', stale_count: freshStale.length });
    return NextResponse.json({ ok: false, stale: freshStale, alertSent: false }, { status: 500 });
  }
}
