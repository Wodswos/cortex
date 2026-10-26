import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../utils';

/** 视图切换器:胶囊式 segmented control */
export const Segmented = TabsPrimitive.Root;

export const SegmentedList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex items-center gap-0.5 rounded-xl glass p-0.5 no-scrollbar overflow-x-auto max-w-full',
      className,
    )}
    {...props}
  />
));
SegmentedList.displayName = 'SegmentedList';

export const SegmentedTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'whitespace-nowrap rounded-[10px] px-3 h-8 text-sm font-medium text-muted transition-all',
      'hover:text-foreground',
      'data-[state=active]:gradient-bg data-[state=active]:text-white data-[state=active]:shadow-sm',
      className,
    )}
    {...props}
  />
));
SegmentedTrigger.displayName = 'SegmentedTrigger';

export const SegmentedContent = TabsPrimitive.Content;
