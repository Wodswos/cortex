import * as React from 'react';
import { cn } from '../utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-foreground placeholder:text-muted/60 outline-none transition-colors',
        'focus:border-[color-mix(in_srgb,var(--accent-from)_60%,transparent)] focus:ring-2 focus:ring-[var(--ring)]/30',
        'disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-foreground placeholder:text-muted/60 outline-none transition-colors',
        'focus:border-[color-mix(in_srgb,var(--accent-from)_60%,transparent)] focus:ring-2 focus:ring-[var(--ring)]/30',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
