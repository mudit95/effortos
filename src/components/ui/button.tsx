'use client';

import * as React from 'react';
import {
  buttonClasses,
  type ButtonVariant,
  type ButtonSize,
} from './button-classes';

// Re-export so existing `import { buttonClasses } from '@/components/ui/button'`
// call sites keep working — server components should ideally import directly
// from './button-classes' instead, and Next prerender will be happy either way
// now that the helper lives outside the 'use client' boundary.
export { buttonClasses };
export type { ButtonVariant, ButtonSize };

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
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
