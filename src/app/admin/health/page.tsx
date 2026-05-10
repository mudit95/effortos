import { requireAdmin } from '@/lib/admin';
import { CRON_CATALOG } from '@/lib/cron-run-log';
import { getGlobalAiUsageToday } from '@/lib/aiQuota';
import { beastDailyCap, beastModeDisabled } from '@/lib/beast-mode';
import { AlertTriangle, CheckCircle2, Clock, DollarSign, Mail, Bot, Shield, Zap } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * /admin/health — single-pane system health.
 *
 * What this answers:
 *   1. Are my crons actually running, and how recently?
 *   2. Are my email + WhatsApp deliveries actually landing?
 *   3. Am I about to blow my Anthropic budget today?
 *   4. Is Beast Mode safe (kill switch, daily cap)?
 *
 * Renders server-side, force-dynamic so the numbers are always fresh.
 * Admin-only via requireAdmin (same pattern as the other /admin routes).
 *
 * Why this page exists:
 *   The codebase had several silent-failure bugs that a single dashboard
 *   would have surfaced in five seconds. Email crons recording 'success'
 *   while every send bounced; coach cron skipping AI quota gates; Beast
 *   Mode lacking a kill switch. This page is the place an operator should
 *   check first when a user complaint comes in.
 */
export default async function AdminHealthPage() {
  const check = await requireAdmin();
  if (!check.ok) return null;
  const { supabase } = check;

  // Server component, force-dynamic, runs once per request — Date.now()
  // is the right thing to call here. The react-hooks/purity rule warns
  // about non-deterministic calls in render, but on the server side
  // every render IS a fresh request, so a wall-clock read is exactly
  // the freshness signal we want for a status dashboard.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const dayStart = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  // ── Cron health ──────────────────────────────────────────────────
  // For each registered cron, find its most recent success row and
  // compute "minutes ago." Anything older than its staleAfterMinutes
  // threshold is rendered red.
  const cronNames = CRON_CATALOG.map((c) => c.name);
  const { data: cronRows } = await supabase
    .from('cron_run_log')
    .select('cron_name, status, ran_at, details')
    .in('cron_name', cronNames)
    .gte('ran_at', weekAgo)
    .order('ran_at', { ascending: false });

  const lastByName = new Map<string, { status: string; ran_at: string; details: unknown }>();
  for (const row of cronRows ?? []) {
    if (!lastByName.has(row.cron_name)) {
      lastByName.set(row.cron_name, {
        status: row.status,
        ran_at: row.ran_at,
        details: row.details,
      });
    }
  }
  const lastSuccessByName = new Map<string, string>();
  for (const row of cronRows ?? []) {
    if (row.status === 'success' && !lastSuccessByName.has(row.cron_name)) {
      lastSuccessByName.set(row.cron_name, row.ran_at);
    }
  }

  // ── Email delivery rate (24h) ────────────────────────────────────
  const { count: emailsSent } = await supabase
    .from('email_log')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gte('created_at', dayStart);
  const { count: emailsFailed } = await supabase
    .from('email_log')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'failed')
    .gte('created_at', dayStart);

  // ── Beast Mode counts (24h) ──────────────────────────────────────
  const { count: beastSent } = await supabase
    .from('beast_nudge_log')
    .select('id', { count: 'exact', head: true })
    .eq('delivered', true)
    .gte('created_at', dayStart);
  const { count: beastAttempted } = await supabase
    .from('beast_nudge_log')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', dayStart);
  const { count: beastEnabledUsers } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('beast_mode_enabled', true);

  // ── AI spend (today, UTC) ────────────────────────────────────────
  const aiUsage = await getGlobalAiUsageToday();
  // $5/M blended is a reasonable Haiku 4.5 cost estimate for input+output.
  // This is a guide-rail, not billing-grade — surface the rough USD so
  // an operator sees "we're at $32 today" before they see "10M tokens".
  const estUsd = (aiUsage.used / 1_000_000) * 5;
  const estUsdLimit = (aiUsage.limit / 1_000_000) * 5;
  const usagePct = aiUsage.limit > 0 ? Math.min(100, (aiUsage.used / aiUsage.limit) * 100) : 0;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold">System health</h2>
        <p className="text-sm text-white/50 mt-1">
          One screen. The first place to check when something feels off.
        </p>
      </div>

      {/* ── Top KPIs ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          icon={Mail}
          label="Emails sent (24h)"
          value={emailsSent ?? 0}
          sub={emailsFailed && emailsFailed > 0 ? `${emailsFailed} failed` : 'no failures'}
          warn={(emailsFailed ?? 0) > 0 && (emailsSent ?? 0) === 0}
        />
        <KpiCard
          icon={Bot}
          label="Beast nudges (24h)"
          value={beastSent ?? 0}
          sub={`of ${beastAttempted ?? 0} attempted · ${beastEnabledUsers ?? 0} users opted in`}
          warn={false}
        />
        <KpiCard
          icon={DollarSign}
          label="AI spend today"
          value={`~$${estUsd.toFixed(2)}`}
          sub={`${aiUsage.used.toLocaleString()} / ${aiUsage.limit.toLocaleString()} tokens · ${usagePct.toFixed(0)}%`}
          warn={usagePct >= 80}
        />
        <KpiCard
          icon={Shield}
          label="Beast kill switch"
          value={beastModeDisabled() ? 'DISABLED' : 'ARMED'}
          sub={`Daily cap: ${beastDailyCap()} per user`}
          warn={beastModeDisabled()}
        />
      </div>

      {/* ── AI budget bar ────────────────────────────────────────── */}
      <div className="p-5 rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-400" />
            Anthropic global budget (today, UTC)
          </h3>
          <span className="text-xs text-white/40">
            ~${estUsd.toFixed(2)} of ~${estUsdLimit.toFixed(2)} ceiling
          </span>
        </div>
        <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              usagePct >= 80
                ? 'bg-red-500/70'
                : usagePct >= 60
                ? 'bg-amber-500/70'
                : 'bg-cyan-500/60'
            }`}
            style={{ width: `${usagePct}%` }}
          />
        </div>
        <p className="text-[11px] text-white/35 mt-2">
          Once 100%, every Anthropic-backed feature falls back to static templates until UTC midnight.
          Investigate before bumping <code className="text-white/55">AI_GLOBAL_DAILY_TOKEN_LIMIT</code>.
        </p>
      </div>

      {/* ── Cron status table ────────────────────────────────────── */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="p-5 border-b border-white/[0.04] flex items-center gap-2">
          <Clock className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold">Cron health</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="text-[11px] text-white/40 uppercase tracking-wider">
            <tr className="border-b border-white/[0.04]">
              <th className="text-left p-3">Cron</th>
              <th className="text-left p-3">Last status</th>
              <th className="text-left p-3">Last success</th>
              <th className="text-left p-3">Tolerance</th>
            </tr>
          </thead>
          <tbody>
            {CRON_CATALOG.map((entry) => {
              const lastRun = lastByName.get(entry.name);
              const lastSuccess = lastSuccessByName.get(entry.name);
              const ageMs = lastSuccess
                ? now - new Date(lastSuccess).getTime()
                : Number.POSITIVE_INFINITY;
              const ageMin = Math.round(ageMs / 60000);
              const stale = ageMin > entry.staleAfterMinutes;
              return (
                <tr key={entry.name} className="border-b border-white/[0.03] last:border-b-0">
                  <td className="p-3">
                    <div className="font-mono text-[13px]">{entry.name}</div>
                    <div className="text-[11px] text-white/35">{entry.description}</div>
                  </td>
                  <td className="p-3">
                    {!lastRun ? (
                      <Pill kind="warn">never run</Pill>
                    ) : lastRun.status === 'success' ? (
                      <Pill kind="ok">success</Pill>
                    ) : (
                      <Pill kind="bad">failure</Pill>
                    )}
                  </td>
                  <td className="p-3">
                    {!lastSuccess ? (
                      <span className="text-white/35">—</span>
                    ) : (
                      <span className={stale ? 'text-red-400' : 'text-white/65'}>
                        {ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-white/40">
                    {entry.staleAfterMinutes < 90
                      ? `${entry.staleAfterMinutes}m`
                      : entry.staleAfterMinutes >= 60 * 24
                      ? `${Math.round(entry.staleAfterMinutes / 60 / 24)}d`
                      : `${Math.round(entry.staleAfterMinutes / 60)}h`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  warn,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub: string;
  warn: boolean;
}) {
  return (
    <div
      className={`p-4 rounded-xl border ${
        warn ? 'border-amber-500/25 bg-amber-500/[0.03]' : 'border-white/[0.06] bg-white/[0.02]'
      }`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-white/40 uppercase tracking-wider">{label}</p>
        <Icon className={`w-4 h-4 ${warn ? 'text-amber-400' : 'text-white/30'}`} />
      </div>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      <p className="text-[11px] text-white/40 mt-1">{sub}</p>
    </div>
  );
}

function Pill({ kind, children }: { kind: 'ok' | 'warn' | 'bad'; children: React.ReactNode }) {
  const styles: Record<typeof kind, string> = {
    ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
    warn: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
    bad: 'bg-red-500/15 text-red-300 border-red-500/20',
  } as const;
  const Icon = kind === 'ok' ? CheckCircle2 : AlertTriangle;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${styles[kind]}`}
    >
      <Icon className="w-3 h-3" />
      {children}
    </span>
  );
}
