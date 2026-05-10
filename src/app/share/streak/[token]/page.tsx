/**
 * Public streak share page.
 *
 * Reached via /share/streak/<token>. Anonymous-readable, server-rendered.
 * Anyone with the URL can see:
 *   - Owner's first name + current streak
 *   - Longest streak
 *   - Total focus minutes lifetime
 *   - Started in <month year>
 *
 * What we DO NOT expose:
 *   - Email, full name, user_id
 *   - Task titles, journal entries, goal names
 *   - Anything that could let a stranger reverse the user's account
 *
 * Token revocation is honored immediately (no edge cache; see
 * dynamic = 'force-dynamic') so a user pressing "Revoke share link"
 * in their dashboard takes effect on the next visit.
 *
 * The opengraph-image.tsx file at the same path generates the unfurl
 * card for WhatsApp / Twitter / iMessage; both files share the same
 * resolveStreakShareToken helper so the page and the OG card never
 * disagree about counts.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Flame, Clock, Trophy, Sparkles } from 'lucide-react';
import { resolveStreakShareToken, formatJoinedMonth } from '@/lib/share-streak';
import { buttonClasses } from '@/components/ui/button-classes';

// Force dynamic rendering — token revocation must take effect on the
// next request, not after edge cache eventually expires. Streaks also
// change daily so static rendering would serve stale counts.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PageProps = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { token } = await params;
  const result = await resolveStreakShareToken(token);
  if (result.status !== 'ok') {
    return {
      title: 'Streak share — EffortOS',
      description: 'This share link is no longer active.',
    };
  }
  const { firstName, currentStreak } = result.data;
  return {
    title: `${firstName} is on a ${currentStreak}-day focus streak — EffortOS`,
    description: `${firstName} has logged ${currentStreak} consecutive days of focus sessions on EffortOS. Build your own streak.`,
    openGraph: {
      title: `${firstName} is on a ${currentStreak}-day focus streak`,
      description: 'Built with EffortOS — Pomodoro coaching that adapts.',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${firstName} is on a ${currentStreak}-day focus streak`,
    },
  };
}

export default async function StreakSharePage({ params }: PageProps) {
  const { token } = await params;
  const result = await resolveStreakShareToken(token);

  if (result.status === 'not_found') {
    // Use Next's notFound() so the platform 404 page renders.
    notFound();
  }

  if (result.status === 'revoked') {
    // Distinct from 404 — the token DID exist but the owner revoked.
    // Show a softer empty state with the upgrade CTA.
    return <RevokedView />;
  }

  const { firstName, currentStreak, longestStreak, joinedDate, totalFocusMinutes } = result.data;

  return (
    <div className="min-h-screen bg-[#0B0F14] text-white flex items-center justify-center px-6 py-12">
      <div className="max-w-2xl w-full">
        {/* Brand mark */}
        <div className="flex items-center gap-3 mb-12">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/[0.08] border border-cyan-400/30 flex items-center justify-center text-cyan-400 font-bold text-xl">
            E
          </div>
          <span className="text-lg font-semibold tracking-tight">EffortOS</span>
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight mb-3">
          {firstName} is on a{' '}
          <span className="text-orange-400">
            {currentStreak}-day
          </span>{' '}
          focus streak.
        </h1>
        <p className="text-lg text-white/55 mb-12">
          {currentStreak === 0
            ? `${firstName} is taking a break — but the longest run was ${longestStreak} days.`
            : `Started in ${formatJoinedMonth(joinedDate)}. Going strong.`}
        </p>

        {/* Stats grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
          <Stat
            icon={<Flame className="w-5 h-5 text-orange-400" />}
            label="Current"
            value={`${currentStreak}`}
            unit={currentStreak === 1 ? 'day' : 'days'}
          />
          <Stat
            icon={<Trophy className="w-5 h-5 text-yellow-400" />}
            label="Longest"
            value={`${longestStreak}`}
            unit={longestStreak === 1 ? 'day' : 'days'}
          />
          <Stat
            icon={<Clock className="w-5 h-5 text-cyan-400" />}
            label="Total focus"
            value={formatMinutes(totalFocusMinutes)}
            unit="hrs"
          />
        </div>

        {/* CTA */}
        <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-cyan-500/[0.06] to-purple-500/[0.04] p-6 sm:p-8">
          <div className="flex items-start gap-3 mb-4">
            <Sparkles className="w-5 h-5 text-cyan-400 mt-1 shrink-0" />
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Build your own streak.
            </h2>
          </div>
          <p className="text-white/60 mb-6 leading-relaxed">
            EffortOS is an AI-powered Pomodoro coach. Plan less, carry forward in three taps, get a
            WhatsApp nudge when you&rsquo;re about to break a streak. First three days are free.
          </p>
          <Link
            href="/?utm_source=streak_share&utm_medium=referral"
            className={buttonClasses({ size: 'lg', className: 'gap-2' })}
          >
            Try it free
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        {/* Footer */}
        <div className="text-xs text-white/30 mt-12 text-center">
          Shared by {firstName} via EffortOS · effortos.com
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-white/40 mb-2">
        {icon}
        {label}
      </div>
      <p className="text-3xl font-bold leading-none">
        {value}
        <span className="text-base font-normal text-white/40 ml-1.5">{unit}</span>
      </p>
    </div>
  );
}

/** Big number in minutes → "X.Y" hours-with-minute precision. */
function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 10) return hours.toFixed(1);
  return `${Math.round(hours)}`;
}

function RevokedView() {
  return (
    <div className="min-h-screen bg-[#0B0F14] text-white flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 rounded-full bg-white/[0.04] mx-auto mb-6 flex items-center justify-center">
          <Sparkles className="w-7 h-7 text-white/30" />
        </div>
        <h1 className="text-2xl font-bold mb-2">This share has been revoked</h1>
        <p className="text-white/55 mb-8">
          The owner of this streak is no longer sharing publicly. You can still build your own
          streak with EffortOS.
        </p>
        <Link href="/" className={buttonClasses({ className: 'gap-2' })}>
          Try EffortOS
        </Link>
      </div>
    </div>
  );
}
