/**
 * OG image for the public streak share page.
 *
 * Auto-wired by Next's file-based metadata convention — when someone
 * pastes /share/streak/<token> into WhatsApp/Twitter/iMessage, this is
 * what unfurls. 1200×630 (Open Graph spec; Twitter summary_large_image
 * reuses the ratio).
 *
 * Visual hierarchy:
 *   1. Streak number — biggest, orange (matches the Flame icon).
 *   2. "<Name> is on a [N]-day focus streak" caption.
 *   3. EffortOS wordmark in the corner.
 *
 * Satori (the renderer behind ImageResponse) supports a flexbox subset
 * of CSS — no grid, no transforms beyond a few. We mirror the styling
 * conventions from the root /opengraph-image.tsx so the brand stays
 * consistent across unfurl surfaces.
 *
 * If the token is invalid or revoked, we render a fallback OG card —
 * dark gradient with the EffortOS wordmark and "Build your own streak"
 * — so the unfurl still looks intentional rather than broken.
 */

import { ImageResponse } from 'next/og';
import { resolveStreakShareToken } from '@/lib/share-streak';

export const runtime = 'edge';
export const alt = 'EffortOS — focus streak share';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type Props = {
  params: Promise<{ token: string }>;
};

export default async function Image({ params }: Props) {
  const { token } = await params;
  const result = await resolveStreakShareToken(token);

  if (result.status !== 'ok') {
    return fallbackImage();
  }

  const { firstName, currentStreak, longestStreak } = result.data;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 84px',
          backgroundColor: '#0B0F14',
          backgroundImage:
            'linear-gradient(135deg, rgba(251,146,60,0.10) 0%, rgba(11,15,20,0) 50%), linear-gradient(315deg, rgba(34,211,238,0.06) 0%, rgba(11,15,20,0) 50%)',
          color: 'white',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        {/* Top row: brand mark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              backgroundColor: '#0F141B',
              border: '2px solid rgba(34,211,238,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 42,
              fontWeight: 800,
              color: '#22d3ee',
              letterSpacing: -2,
            }}
          >
            E
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -1 }}>EffortOS</div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
              effortos.com
            </div>
          </div>
        </div>

        {/* Centerpiece: streak number + caption */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 24,
              fontSize: 220,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: -8,
              color: '#fb923c',
            }}
          >
            {currentStreak}
            <span
              style={{
                fontSize: 56,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.7)',
                letterSpacing: -1.5,
              }}
            >
              {currentStreak === 1 ? 'day' : 'days'}
            </span>
          </div>
          <div
            style={{
              fontSize: 44,
              fontWeight: 700,
              lineHeight: 1.15,
              letterSpacing: -1.5,
              maxWidth: 1000,
            }}
          >
            {firstName} is on a focus streak.
          </div>
        </div>

        {/* Bottom row: longest streak pill + CTA */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 22px',
              borderRadius: 999,
              backgroundColor: 'rgba(250,204,21,0.10)',
              border: '1px solid rgba(250,204,21,0.30)',
              color: '#facc15',
              fontSize: 22,
              fontWeight: 600,
            }}
          >
            <span>🏆</span>
            <span>Longest run: {longestStreak} {longestStreak === 1 ? 'day' : 'days'}</span>
          </div>
          <div
            style={{
              fontSize: 22,
              color: 'rgba(255,255,255,0.55)',
              fontWeight: 500,
            }}
          >
            Build your own → effortos.com
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

/**
 * Rendered when the token is missing or revoked. Keeps the unfurl
 * intentional rather than broken — the destination page itself
 * shows a "this share has been revoked" message.
 */
function fallbackImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '72px',
          backgroundColor: '#0B0F14',
          backgroundImage:
            'linear-gradient(135deg, rgba(34,211,238,0.08) 0%, rgba(11,15,20,0) 50%)',
          color: 'white',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 24,
            backgroundColor: '#0F141B',
            border: '2px solid rgba(34,211,238,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 56,
            fontWeight: 800,
            color: '#22d3ee',
            letterSpacing: -2,
            marginBottom: 32,
          }}
        >
          E
        </div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: -2,
            marginBottom: 12,
          }}
        >
          Build your own streak.
        </div>
        <div style={{ fontSize: 28, color: 'rgba(255,255,255,0.6)' }}>
          EffortOS — focus that adapts. effortos.com
        </div>
      </div>
    ),
    { ...size },
  );
}
