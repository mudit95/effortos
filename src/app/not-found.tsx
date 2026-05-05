import Link from 'next/link';
import { buttonClasses } from '@/components/ui/button';

/**
 * Catch-all 404 page. Kept deliberately minimal — no client-side JS and no
 * framer-motion — so Next.js can serve it as a static route for any unknown
 * URL with zero hydration cost.
 *
 * The visual language matches `error.tsx` (same bg, same button styles) so
 * that users who land here by accident still feel they're inside EffortOS.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0B0F14] text-white p-4">
      <div className="text-center max-w-md">
        <p className="text-sm font-mono text-cyan-400/60 tracking-widest mb-3">
          404
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-white mb-3">
          Page not found
        </h1>
        <p className="text-white/50 text-sm mb-8 leading-relaxed">
          The link you followed may be broken, or the page may have been moved.
          Let&apos;s get you back to something useful.
        </p>
        <div className="flex gap-3 justify-center">
          <Link href="/" className={buttonClasses()}>
            Go to dashboard
          </Link>
          <Link href="/legal/privacy" className={buttonClasses({ variant: 'secondary' })}>
            Privacy
          </Link>
        </div>
      </div>
    </div>
  );
}
