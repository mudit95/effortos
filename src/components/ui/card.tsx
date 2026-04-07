'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'glass' | 'glow';
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const variants = {
      default: 'bg-white/[0.03] border border-white/[0.06]',
      glass: 'bg-white/[0.05] border border-white/[0.08] backdrop-blur-xl',
      glow: 'bg-white/[0.03] border border-cyan-500/20 shadow-lg shadow-cyan-500/5',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'rounded-2xl p-6 transition-all duration-300',
          variants[variant],
          className
        )}
        {...props}
      />
    );
  }
);

Card.displayName = 'Card';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-sm font-medium text-white/50 uppercase tracking-wider', className)}
      {...props}
    />
  )
);
CardTitle.displayName = 'CardTitle';

const CardValue = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn('text-2xl font-bold text-white mt-1', className)}
      {...props}
    />
  )
);
CardValue.displayName = 'CardValue';

export { Card, CardTitle, CardValue };
