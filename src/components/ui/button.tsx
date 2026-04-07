'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'glow';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center rounded-xl font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F14] disabled:pointer-events-none disabled:opacity-50';

    const variants = {
      default: 'bg-cyan-600 text-white hover:bg-cyan-500 active:bg-cyan-700 shadow-lg shadow-cyan-900/20',
      secondary: 'bg-white/10 text-white hover:bg-white/15 active:bg-white/20 border border-white/10',
      outline: 'border border-white/20 text-white/80 hover:bg-white/5 hover:text-white',
      ghost: 'text-white/60 hover:text-white hover:bg-white/5',
      destructive: 'bg-red-600/80 text-white hover:bg-red-500 active:bg-red-700',
      glow: 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-400 hover:to-blue-400 shadow-lg shadow-cyan-500/25 active:shadow-cyan-500/10',
    };

    const sizes = {
      sm: 'h-8 px-3 text-sm',
      md: 'h-10 px-5 text-sm',
      lg: 'h-12 px-8 text-base',
      icon: 'h-10 w-10',
    };

    return (
      <button
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
export { Button };
