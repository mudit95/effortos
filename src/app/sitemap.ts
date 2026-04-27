/**
 * /sitemap.xml — generated via Next.js MetadataRoute convention.
 *
 * We only list public, indexable pages here. The dashboard and admin pages
 * are auth-gated and pointless to advertise to crawlers. Legal pages get
 * lower priority but stay indexable so a "EffortOS refund policy" search
 * resolves correctly.
 *
 * `lastModified` is set to the build time. That's a coarse but honest
 * signal — Next.js doesn't give us a per-page git timestamp without extra
 * tooling, and lying with a fixed date is worse than re-stamping on deploy.
 */

import type { MetadataRoute } from 'next';

const SITE_URL = (() => {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
})();

type SitemapEntry = MetadataRoute.Sitemap[number];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const make = (
    path: string,
    priority: number,
    changeFrequency: SitemapEntry['changeFrequency'],
  ): SitemapEntry => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  });

  return [
    // Homepage — the only marketing surface, gets top priority.
    make('/', 1.0, 'weekly'),

    // Auth entry points — crawlable so "sign in to EffortOS" search works,
    // but lower priority than the home page.
    make('/signin', 0.5, 'monthly'),
    make('/login', 0.5, 'monthly'),

    // Legal pages — indexable, rarely change.
    make('/legal/terms', 0.3, 'yearly'),
    make('/legal/privacy', 0.3, 'yearly'),
    make('/legal/refund', 0.3, 'yearly'),
    make('/legal/shipping', 0.3, 'yearly'),
    make('/legal/contact', 0.4, 'yearly'),
  ];
}
