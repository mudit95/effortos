'use client';

/**
 * Root-level error boundary. This runs when the root `layout.tsx` or any
 * provider above the normal `error.tsx` boundary throws — the situations
 * where page-level error.tsx can't render because the html/body chain is
 * itself broken.
 *
 * Must render its own <html>/<body> because it replaces the root layout
 * entirely. Keep it minimal: no Tailwind (styles may not have loaded),
 * no framer-motion, no stores. If this file crashes, the browser shows
 * the generic "application error" screen and that's our last line.
 */
import React, { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { digest: error.digest ?? 'none', source: 'app/global-error.tsx' },
      level: 'fatal',
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0B0F14',
          color: '#fff',
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          padding: 16,
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <p
            style={{
              fontSize: 13,
              letterSpacing: 2,
              color: 'rgba(34,211,238,0.6)',
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              marginBottom: 12,
            }}
          >
            FATAL
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px' }}>
            Something broke at the root of the app.
          </h1>
          <p
            style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.5)',
              margin: '0 0 24px',
              lineHeight: 1.5,
            }}
          >
            We&apos;ve reported this to our monitoring system. Try reloading — if it
            happens again, clearing your browser storage usually resolves it.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                height: 40,
                padding: '0 20px',
                borderRadius: 10,
                border: 'none',
                background: '#0891b2',
                color: '#fff',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
            <button
              onClick={() => {
                try {
                  localStorage.clear();
                  sessionStorage.clear();
                } catch {
                  /* ignore */
                }
                window.location.href = '/';
              }}
              style={{
                height: 40,
                padding: '0 20px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.85)',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Reset &amp; reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
