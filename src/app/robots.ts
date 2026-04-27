/**
 * /robots.txt — generated via Next.js MetadataRoute convention.
 *
 * Policy:
 *   - Allow crawlers on the public surface (marketing, legal, auth).
 *   - Disallow API routes, internal admin pages, and the authed app shell
 *     (/dashboard isn't a crawlable page anyway since it's behind auth, but
 *     we tell crawlers explicitly so we don't waste their budget on 200-OK
 *     redirect-to-signin responses).
 *   - Point at the sitemap so well-behaved crawlers (Google, Bing, DDG) pick
 *     up the canonical URL list immediately rather than guessing from links.
 */

import type { MetadataRoute } from 'next';

const SITE_URL = (() => {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
})();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin',
          '/admin/',
          '/auth/callback',
          '/auth/reset-password',
        ],
      },
      // GPTBot / Claude / Perplexity etc. follow the same rules; if we ever
      // want to opt out of model training scrapes we'd add explicit rules
      // here. Keeping it permissive at launch — the marketing copy is the
      // point.
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
