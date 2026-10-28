import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 select-none',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--accent-solid)] text-white hover:brightness-95',
        secondary: 'glass text-foreground hover:border-[var(--border-strong)]',
        ghost: 'text-muted hover:text-foreground hover:bg-[var(--surface)]',
        outline:
          'border border-[var(--border-strong)] text-foreground hover:border-[color-mix(in_srgb,var(--accent-from)_50%,transparent)]',
        danger:
          'bg-[var(--danger)]/15 text-[var(--danger)] border border-[var(--danger)]/30 hover:bg-[var(--danger)]/25',
        link: 'text-[var(--accent-from)] underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-11 px-6 text-base',
        icon: 'h-9 w-9',
        'icon-sm': 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
