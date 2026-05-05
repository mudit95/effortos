'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'glow';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const BASE_STYLES = 'inline-flex items-center justify-center rounded-xl font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F14] disabled:pointer-events-none disabled:opacity-50';

// Default primary aligned to what's actually used across the app — 15+
// bespoke buttons in /share, /unsubscribe, FirstSessionRitual, etc. all
// settled on cyan-500 with dark text. Was previously cyan-600 + white,
// which only existed on the primitive and nowhere in actual UI.
const VARIANT_STYLES: Record<ButtonVariant, string> = {
  default: 'bg-cyan-500 text-[#0B0F14] hover:bg-cyan-400 active:bg-cyan-600 shadow-lg shadow-cyan-500/15 font-semibold',
  secondary: 'bg-white/10 text-white hover:bg-white/15 active:bg-white/20 border border-white/10',
  outline: 'border border-white/20 text-white/80 hover:bg-white/5 hover:text-white',
  ghost: 'text-white/60 hover:text-white hover:bg-white/5',
  destructive: 'bg-red-600/80 text-white hover:bg-red-500 active:bg-red-700',
  glow: 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-400 hover:to-blue-400 shadow-lg shadow-cyan-500/25 active:shadow-cyan-500/10',
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-5 text-sm',
  lg: 'h-12 px-8 text-base',
  icon: 'h-10 w-10',
};

/**
 * Standalone class generator — use when you need the button's visual
 * styles on a non-`<button>` element (e.g. Next's `<Link>`). The
 * canonical example is the public `/share/streak` page where the CTA
 * is a Link to the marketing site, not a form button.
 *
 * Usage:
 *   <Link href="/foo" className={buttonClasses({ size: 'lg' })}>...</Link>
 *
 * Keeps the primitive's styles in one place; consumers don't drift.
 */
export function buttonClasses({
  variant = 'default',
  size = 'md',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(BASE_STYLES, VARIANT_STYLES[variant], SIZE_STYLES[size], className);
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    return (
      <button
        className={buttonClasses({ variant, size, className })}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
export { Button };
