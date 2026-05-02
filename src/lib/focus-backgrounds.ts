/**
 * Focus-mode background catalog.
 *
 * Three kinds of background entries in the union below:
 *
 *   1. 'gradient' — pure CSS, zero network traffic, always works.
 *      Ships unconditionally. These are the "safe defaults" that
 *      render the moment a user picks them, with no flash, no spinner.
 *
 *   2. 'image'    — static still backed by a remote URL (Pexels free
 *      tier or Pixabay CC0). The browser fetches at render time, so
 *      this works even though the build sandbox can't reach those
 *      CDNs — the user's browser can. Bundled IDs are populated by
 *      `scripts/seed-assets.ts` (run on the user's machine, which has
 *      internet) — until that runs, the array below is empty and the
 *      picker just shows gradients.
 *
 *   3. 'video'    — looping MP4/WebM clip. Same sourcing story as
 *      images. Disabled at render time when the user's OS is set to
 *      `prefers-reduced-motion: reduce`; the BackgroundPicker swaps
 *      in the entry's `posterUrl` as a static fallback.
 *
 * Custom uploads (Supabase Storage bucket `focus-backgrounds`, mig 036)
 * are NOT in this catalog — they're resolved separately at render time
 * because their URLs are user-specific signed URLs that rotate.
 *
 * Adding a default:
 *   1. Run `npm run seed:assets` to fetch fresh Pexels/Pixabay assets.
 *   2. The script appends entries to BUNDLED_BACKGROUNDS via codegen
 *      below the static section. Don't hand-edit the codegen block.
 *   3. Each entry's `attribution` is preserved per Pexels/Pixabay
 *      attribution requirements, even though both licences allow
 *      omitting it — being a good citizen is cheap insurance.
 */

export type FocusBackgroundType = 'gradient' | 'image' | 'video';

export interface FocusBackground {
  /**
   * Stable identifier — referenced by profiles.focus_background_id.
   * Format: '<type>-<short-name>' (e.g., 'gradient-amber',
   * 'image-mountains-1', 'video-rain-window-1').
   * Never reuse an id; if a default is removed, retire the id.
   */
  id: string;
  /** Display label in the picker tile. */
  label: string;
  /** Short blurb, ≤ 50 chars, shown under the tile on hover. */
  blurb?: string;
  type: FocusBackgroundType;

  /**
   * For 'gradient': a CSS background string applied straight to the
   * focus-mode container. Hand-tuned for legibility against white
   * timer text.
   */
  gradientCss?: string;

  /**
   * For 'image' / 'video': the full asset URL. Browser fetches at
   * render time. Always HTTPS, always CORS-friendly per the source's
   * documented behaviour. Empty array of bundled remote entries by
   * default — populated by `scripts/seed-assets.ts`.
   */
  url?: string;

  /** For 'video': a still poster URL used while the clip loads AND
   *  as the static fallback under prefers-reduced-motion. */
  posterUrl?: string;

  /** Photographer / source attribution. Optional per Pexels + Pixabay
   *  free-tier licences but rendered in a small footer credit when
   *  present. */
  attribution?: {
    /** Display name (photographer or uploader). */
    by: string;
    /** Source page URL. */
    sourceUrl: string;
    /** Provider name — used in copy ("via Pexels"). */
    provider: 'Pexels' | 'Pixabay' | 'Unsplash';
  };
}

/**
 * Pure-CSS gradient defaults. These ship unconditionally — no remote
 * fetch, no licensing concerns, instant render. Hand-picked so the
 * timer stays readable on every one (we test against white #FFFFFF
 * text at 96px in FocusMode).
 *
 * Order matters — first item is what new users see when they first
 * open the picker. Sunset-amber is intentionally first because it
 * tests well in early-morning + late-evening light.
 */
const GRADIENT_BACKGROUNDS: FocusBackground[] = [
  {
    id: 'gradient-amber',
    label: 'Sunset',
    blurb: 'Warm amber gradient',
    type: 'gradient',
    gradientCss:
      'radial-gradient(ellipse at center, #2b1d10 0%, #0d0708 70%), linear-gradient(180deg, #271509 0%, #0a0506 100%)',
  },
  {
    id: 'gradient-deep-blue',
    label: 'Deep ocean',
    blurb: 'Cool indigo wash',
    type: 'gradient',
    gradientCss:
      'radial-gradient(ellipse at top, #0e1a2e 0%, #050810 70%), linear-gradient(180deg, #0a1226 0%, #030509 100%)',
  },
  {
    id: 'gradient-forest',
    label: 'Forest',
    blurb: 'Mossy green dusk',
    type: 'gradient',
    gradientCss:
      'radial-gradient(ellipse at center, #0e1f1a 0%, #050a08 70%), linear-gradient(180deg, #0a1612 0%, #020403 100%)',
  },
  {
    id: 'gradient-aurora',
    label: 'Aurora',
    blurb: 'Soft cyan + violet',
    type: 'gradient',
    gradientCss:
      'radial-gradient(circle at 30% 30%, rgba(34,211,238,0.15) 0%, transparent 50%), radial-gradient(circle at 70% 70%, rgba(139,92,246,0.15) 0%, transparent 50%), #06080d',
  },
  {
    id: 'gradient-noir',
    label: 'Noir',
    blurb: 'Pure black, no decoration',
    type: 'gradient',
    gradientCss: '#000000',
  },
];

/**
 * Bundled video backgrounds — sourced from Pixabay (CC0 / Pixabay
 * Content License, no attribution required, commercial use OK,
 * no subscription dependency). Files live under /public/backgrounds/
 * and are served as static assets. Each was re-encoded to 540p,
 * H.264, no audio (background videos are silent), CRF 28-32 to
 * keep bundle size sane.
 *
 * Total /public/backgrounds/ ≈ 11 MB across 6 entries — well under
 * the budget where Vercel deploy times degrade.
 *
 * Poster images: not generated yet. The video element renders the
 * first frame as a fallback while the rest loads, which is fine for
 * background use (these are loops with no important "first frame").
 * Reduced-motion users get the static first frame via the existing
 * FocusBackgroundLayer fallback.
 */
const SEEDED_REMOTE_BACKGROUNDS: FocusBackground[] = [
  {
    id: 'video-rain-window',
    label: 'Rain on window',
    blurb: 'Warm streetlight glow through wet glass',
    type: 'video',
    url: '/backgrounds/rain-window.mp4',
  },
  {
    id: 'video-fireplace',
    label: 'Fireplace',
    blurb: 'Crackling logs, warm flames',
    type: 'video',
    url: '/backgrounds/fireplace.mp4',
  },
  {
    id: 'video-ocean',
    label: 'Ocean shore',
    blurb: 'Slow waves rolling onto a calm beach',
    type: 'video',
    url: '/backgrounds/ocean.mp4',
  },
  {
    id: 'video-snowfall',
    label: 'Snowfall',
    blurb: 'Sunset bokeh, falling snow',
    type: 'video',
    url: '/backgrounds/snowfall.mp4',
  },
  {
    id: 'video-forest-creek',
    label: 'Forest waterfall',
    blurb: 'Mossy creek, soft cascading water',
    type: 'video',
    url: '/backgrounds/forest-creek.mp4',
  },
  {
    id: 'video-candle',
    label: 'Candle flame',
    blurb: 'Single flame, dark backdrop',
    type: 'video',
    url: '/backgrounds/candle.mp4',
  },
];

/** The canonical bundled catalog — what the picker renders by default. */
export const BUNDLED_BACKGROUNDS: ReadonlyArray<FocusBackground> = [
  ...GRADIENT_BACKGROUNDS,
  ...SEEDED_REMOTE_BACKGROUNDS,
];

/** Look up a bundled background by id; returns undefined for unknown ids
 *  (including the 'custom:...' prefix used for user uploads). */
export function getBundledBackground(id: string): FocusBackground | undefined {
  return BUNDLED_BACKGROUNDS.find((b) => b.id === id);
}

/**
 * Resolve a profile's focus_background_id into a render-ready object.
 *
 * Inputs:
 *   - id: profiles.focus_background_id (NULL / 'gradient-x' / 'image-y'
 *         / 'video-z' / 'custom:<storage-key>').
 *   - customResolver: a callback that takes a custom-upload storage key
 *         and returns its signed URL + MIME type. Provided by the
 *         dashboard's user-context — we don't fetch storage signed URLs
 *         from inside this lib because that would couple it to Supabase.
 *
 * Returns the resolved background or null when nothing is selected
 * (caller should fall back to the default gradient).
 *
 * Falls back to gradient-amber when:
 *   - id is set but doesn't match any bundled or custom entry
 *     (deletes/migrations could leave dangling references).
 *   - id is 'custom:...' but the storage object no longer exists
 *     (customResolver returns null).
 */
export function resolveFocusBackground(
  id: string | null | undefined,
  customResolver?: (
    storageKey: string,
  ) => { url: string; mime: string } | null,
): FocusBackground | null {
  if (!id) return null;

  if (id.startsWith('custom:')) {
    const storageKey = id.slice('custom:'.length);
    if (!storageKey || !customResolver) return getBundledBackground('gradient-amber') ?? null;
    const resolved = customResolver(storageKey);
    if (!resolved) return getBundledBackground('gradient-amber') ?? null;
    const isVideo = resolved.mime.startsWith('video/');
    return {
      id,
      label: 'Your upload',
      type: isVideo ? 'video' : 'image',
      url: resolved.url,
    };
  }

  return getBundledBackground(id) ?? getBundledBackground('gradient-amber') ?? null;
}

/**
 * Split the catalog by type — the picker renders these as three
 * separate rows so the user can scan by category. Stable order:
 * gradients first (instant render), then images, then videos
 * (heaviest, last to load).
 */
export function groupedBackgrounds(): Record<FocusBackgroundType, FocusBackground[]> {
  return {
    gradient: BUNDLED_BACKGROUNDS.filter((b) => b.type === 'gradient'),
    image: BUNDLED_BACKGROUNDS.filter((b) => b.type === 'image'),
    video: BUNDLED_BACKGROUNDS.filter((b) => b.type === 'video'),
  };
}
