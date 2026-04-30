/**
 * Skeleton shimmer primitive.
 *
 * Use for "we're about to show real data here" placeholders. Two variants:
 *   - <Skeleton /> renders a single rectangular bar.
 *   - <Skeleton.Text> renders N lines, each with random-ish width.
 *
 * Why a primitive: the Dashboard cold-load shows a blank panel for ~600ms
 * while refreshDashboard, fetchSubscriptionStatus, and the AI brief race
 * to resolve. Empty space feels broken; a placeholder feels intentional.
 * Perceived performance is retention.
 *
 * The shimmer animation respects prefers-reduced-motion via the @media
 * rule below — under reduced motion the bar holds a single shade rather
 * than animating.
 */

import React from 'react';

interface SkeletonProps {
  className?: string;
  /** Optional aria-label so screen readers announce "Loading ..." once
   *  per skeleton block. Default is to mark as `aria-hidden` since the
   *  surrounding container usually carries its own loading semantics. */
  ariaLabel?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ className = '', ariaLabel, style }: SkeletonProps) {
  return (
    <span
      role={ariaLabel ? 'status' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={`block rounded-md bg-white/[0.04] effortos-skeleton ${className}`}
      style={style}
    >
      <style jsx>{`
        .effortos-skeleton {
          position: relative;
          overflow: hidden;
        }
        .effortos-skeleton::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 255, 255, 0.04) 50%,
            rgba(255, 255, 255, 0) 100%
          );
          animation: effortos-skel-shimmer 1.4s ease-in-out infinite;
        }
        @keyframes effortos-skel-shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .effortos-skeleton::after {
            animation: none;
            opacity: 0;
          }
        }
      `}</style>
    </span>
  );
}

/**
 * N lines of skeleton text. Widths vary slightly so the placeholder doesn't
 * look like a perfectly-aligned graphic — closer to real prose.
 */
Skeleton.Text = function SkeletonText({ lines = 2, className = '' }: { lines?: number; className?: string }) {
  // Stable pseudo-random widths so the SSR/CSR hash matches.
  const widths = ['92%', '78%', '85%', '70%', '88%'];
  return (
    <span className={`flex flex-col gap-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: widths[i % widths.length] }} />
      ))}
    </span>
  );
};
