/**
 * /unsubscribe — confirmation page after the email-link unsubscribe flow.
 *
 * The actual mutation happens in /api/unsubscribe (which redirects here on
 * completion). This page is just the human-readable "you're unsubscribed"
 * (or error) confirmation. Keeping the mutation in the API route lets RFC
 * 8058 one-click POSTs work without requiring a browser to render this UI.
 *
 * If a user lands here directly with no `status` query param (typical when
 * the email contains the bare /unsubscribe link without going through the
 * API), we fall back to a brief explanation pointing them at Settings.
 */

import Link from 'next/link';

export const dynamic = 'force-dynamic';

function StatusCard({
  title,
  body,
  tone,
}: {
  title: string;
  body: React.ReactNode;
  tone: 'ok' | 'error' | 'info';
}) {
  const accent =
    tone === 'ok'
      ? 'text-emerald-400'
      : tone === 'error'
      ? 'text-rose-400'
      : 'text-cyan-400';
  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <div className="text-xs font-bold tracking-[0.2em] text-cyan-400 mb-8">
        EFFORTOS
      </div>
      <h1 className={`text-2xl font-semibold mb-4 ${accent}`}>{title}</h1>
      <div className="text-slate-400 text-sm leading-relaxed space-y-3">
        {body}
      </div>
      <div className="mt-10 flex gap-3">
        <Link
          href="/settings"
          className="inline-block bg-cyan-500 text-slate-900 text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-cyan-400 transition"
        >
          Manage email preferences
        </Link>
        <Link
          href="/"
          className="inline-block text-sm text-slate-400 px-5 py-2.5 hover:text-slate-200 transition"
        >
          Back to EffortOS
        </Link>
      </div>
    </div>
  );
}

export default async function UnsubscribePage(props: {
  searchParams: Promise<{ status?: string; reason?: string }>;
}) {
  const params = await props.searchParams;
  const status = params.status;
  const reason = params.reason;

  if (status === 'ok') {
    return (
      <StatusCard
        tone="ok"
        title="You're unsubscribed."
        body={
          <>
            <p>
              We won&rsquo;t send you any more lifecycle emails (morning
              briefs, afternoon check-ins, nightly recaps).
            </p>
            <p>
              Account, billing and security messages will still come
              through &mdash; we can&rsquo;t turn those off.
            </p>
            <p>
              Changed your mind? Re-enable individual digests from Settings.
            </p>
          </>
        }
      />
    );
  }

  if (status === 'error') {
    const friendly =
      reason === 'expired'
        ? 'That unsubscribe link has expired (it’s tied to a date).'
        : reason === 'bad_signature'
        ? 'That unsubscribe link couldn’t be verified. It may have been altered.'
        : reason === 'malformed' || reason === 'missing_token'
        ? 'That unsubscribe link is malformed.'
        : 'Something went wrong on our end. Try the Settings link below.';
    return (
      <StatusCard
        tone="error"
        title="We couldn't process that link"
        body={
          <>
            <p>{friendly}</p>
            <p>
              You can unsubscribe directly from Settings &rarr; Email
              preferences if you&rsquo;re signed in.
            </p>
          </>
        }
      />
    );
  }

  // Default — user landed here without going through the API (e.g. typed
  // the URL or clicked an old link without `?t=...`).
  return (
    <StatusCard
      tone="info"
      title="Manage your email preferences"
      body={
        <>
          <p>
            To unsubscribe, please use the link in any EffortOS email, or
            sign in and adjust your preferences from Settings.
          </p>
        </>
      }
    />
  );
}
