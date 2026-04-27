/**
 * Default Open Graph image for the site.
 *
 * Next.js's file-based metadata convention auto-wires this into the root
 * layout's `openGraph` and `twitter` metadata. The card is what shows up
 * when someone pastes an EffortOS link into WhatsApp, Twitter/X, LinkedIn,
 * iMessage, etc., so the priorities are:
 *
 *   1. Brand mark recognisable at thumbnail size.
 *   2. One sentence that says what we are.
 *   3. The wedge — "Reply 1 on WhatsApp" — visible without squinting.
 *
 * Rendered at 1200×630 (the Open Graph spec; Twitter's summary_large_image
 * also reuses this aspect ratio). Satori (the renderer behind ImageResponse)
 * supports a flexbox subset of CSS — no grid, no transforms beyond a few,
 * no shorthand colors. Stick to basics.
 */
import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'EffortOS — A focus app that adapts when your day falls apart';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
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
          // Subtle radial-ish accent — Satori can't do real radials, so we
          // fake depth with a layered linear-gradient overlay.
          backgroundImage:
            'linear-gradient(135deg, rgba(34,211,238,0.08) 0%, rgba(11,15,20,0) 45%), linear-gradient(315deg, rgba(59,130,246,0.06) 0%, rgba(11,15,20,0) 50%)',
          color: 'white',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        {/* ── Top row: brand mark + wordmark ───────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
          }}
        >
          {/* Hand-rolled brand mark — same shape as /icon-192.svg, but
              expressed inline because Satori can't import remote SVGs and
              the file already exists at /public for HTTP consumers. */}
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 22,
              backgroundColor: '#0F141B',
              border: '2px solid rgba(34,211,238,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 52,
              fontWeight: 800,
              color: '#22d3ee',
              letterSpacing: -2,
            }}
          >
            E
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                fontSize: 36,
                fontWeight: 700,
                letterSpacing: -1,
                color: 'white',
              }}
            >
              EffortOS
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 500,
                color: 'rgba(255,255,255,0.55)',
                marginTop: 2,
              }}
            >
              effortos.com
            </div>
          </div>
        </div>

        {/* ── Centerpiece: tagline ─────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2,
              color: 'white',
              maxWidth: 1000,
            }}
          >
            A focus app that adapts when your day falls apart.
          </div>
          <div
            style={{
              fontSize: 30,
              fontWeight: 400,
              lineHeight: 1.4,
              color: 'rgba(255,255,255,0.7)',
              maxWidth: 940,
            }}
          >
            Plan less. Carry forward in three taps. Reply{' '}
            <span style={{ color: '#22d3ee', fontWeight: 600 }}>“1”</span> on
            WhatsApp to mark a task done.
          </div>
        </div>

        {/* ── Bottom row: pill-shaped audience tag + WhatsApp hint ─── */}
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
              gap: 14,
              padding: '12px 22px',
              borderRadius: 999,
              backgroundColor: 'rgba(34,211,238,0.10)',
              border: '1px solid rgba(34,211,238,0.30)',
              color: '#22d3ee',
              fontSize: 22,
              fontWeight: 600,
            }}
          >
            Built for UPSC · CA · indie founders
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: 'rgba(255,255,255,0.55)',
              fontSize: 22,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                backgroundColor: '#25D366',
              }}
            />
            WhatsApp-native
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
