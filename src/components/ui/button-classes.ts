/**
 * Pure string-composition helper for the button visual system.
 *
 * Lives in its own file (no 'use client' directive) so server
 * components can import it without crossing the client boundary.
 * The previous shape — buttonClasses exported from a 'use client'
 * button.tsx — was fine for the runtime, but Next 16's prerender
 * bails out with "Attempted to call buttonClasses() from the server
 * but buttonClasses is on the client. It's not possible to invoke."
 * because the static export step runs server-side and can't pull
 * symbols from a client module.
 *
 * Pattern: any pure helper that's safe in both worlds (no React,
 * no hooks, no DOM) lives here; the React component lives in
 * button.tsx and re-imports from here.
 */
import { cn } from '@/lib/utils';

export type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'glow';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export const BUTTON_BASE_STYLES =
  'inline-flex items-center justify-center rounded-xl font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F14] disabled:pointer-events-none disabled:opacity-50';

// Default primary aligned to what's actually used across the app — 15+
// bespoke buttons in /share, /unsubscribe, FirstSessionRitual, etc. all
// settled on cyan-500 with dark text. Was previously cyan-600 + white,
// which only existed on the primitive and nowhere in actual UI.
export const BUTTON_VARIANT_STYLES: Record<ButtonVariant, string> = {
  default: 'bg-cyan-500 text-[#0B0F14] hover:bg-cyan-400 active:bg-cyan-600 shadow-lg shadow-cyan-500/15 font-semibold',
  secondary: 'bg-white/10 text-white hover:bg-white/15 active:bg-white/20 border border-white/10',
  outline: 'border border-white/20 text-white/80 hover:bg-white/5 hover:text-white',
  ghost: 'text-white/60 hover:text-white hover:bg-white/5',
  destructive: 'bg-red-600/80 text-white hover:bg-red-500 active:bg-red-700',
  glow: 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-400 hover:to-blue-400 shadow-lg shadow-cyan-500/25 active:shadow-cyan-500/10',
};

export const BUTTON_SIZE_STYLES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-5 text-sm',
  lg: 'h-12 px-8 text-base',
  icon: 'h-10 w-10',
};

/**
 * Standalone class generator — use when you need the button's visual
 * styles on a non-`<button>` element (e.g. Next's `<Link>`).
 *
 * Usage:
 *   <Link href="/foo" className={buttonClasses({ size: 'lg' })}>...</Link>
 *
 * Safe to call from both server and client components.
 */
export function buttonClasses({
  variant = 'default',
  size = 'md',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(
    BUTTON_BASE_STYLES,
    BUTTON_VARIANT_STYLES[variant],
    BUTTON_SIZE_STYLES[size],
    className,
  );
}
