import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-[var(--surface)] border border-[var(--border)] text-muted',
        accent: 'gradient-bg text-white',
        outline: 'border border-[var(--border-strong)] text-foreground',
        success: 'bg-[var(--success)]/12 text-[var(--success)] border border-[var(--success)]/25',
        warning: 'bg-[var(--warning)]/12 text-[var(--warning)] border border-[var(--warning)]/25',
        danger: 'bg-[var(--danger)]/12 text-[var(--danger)] border border-[var(--danger)]/25',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
