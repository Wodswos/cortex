import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../utils';

/**
 * 侧滑/底部抽屉/浮动卡片。
 * - right:桌面详情抽屉 488px(带遮罩,模态)
 * - bottom:手机详情(92vh,带拖拽把手视觉)
 * - float:非模态浮动卡片 —— 无遮罩、不挡住背后的应用(配合 <Sheet modal={false}>),
 *   点外部/Esc/✕ 均可关闭,适合"点开看看"型详情
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: 'right' | 'bottom' | 'left' | 'float';
    title?: string;
    /** 是否渲染深色遮罩(float 默认不渲染) */
    overlay?: boolean;
  }
>(({ className, children, side = 'right', title, overlay = side !== 'float', ...props }, ref) => (
  <DialogPrimitive.Portal>
    {overlay && (
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-fade-up" />
    )}
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 glass-raised outline-none',
        side === 'right' &&
          'inset-y-0 right-0 w-full max-w-[488px] border-l data-[state=open]:animate-fade-up',
        side === 'left' &&
          'inset-y-0 left-0 w-full max-w-[320px] border-r data-[state=open]:animate-fade-up',
        side === 'bottom' &&
          'inset-x-0 bottom-0 max-h-[92vh] rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-fade-up',
        side === 'float' &&
          'right-4 top-16 w-[min(420px,92vw)] rounded-2xl border data-[state=open]:animate-fade-up',
        className,
      )}
      {...props}
    >
      {side === 'bottom' && (
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-[var(--border-strong)]" />
      )}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <DialogPrimitive.Title className="text-sm font-semibold text-muted">
          {title ?? ''}
        </DialogPrimitive.Title>
        <DialogPrimitive.Close className="rounded-md p-1 text-muted transition-colors hover:text-foreground">
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </div>
      <div
        className={cn(
          'overflow-y-auto px-4 pb-6',
          side === 'right' || side === 'left'
            ? 'absolute inset-x-0 top-12 bottom-0'
            : side === 'float'
              ? 'max-h-[calc(100dvh-8rem)]'
              : 'max-h-[80vh]',
        )}
      >
        {children}
      </div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';
