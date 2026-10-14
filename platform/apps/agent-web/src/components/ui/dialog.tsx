import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, title, description, children }: { className?: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="animate-fade-in fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] dark:bg-black/65" />
      <DialogPrimitive.Content className={cn('animate-pop-in fixed left-1/2 top-[10vh] z-50 w-[min(600px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl bg-raised shadow-pop outline-none', className)}>
        <div className="flex items-start justify-between px-5 pb-1 pt-4">
          <div>
            <DialogPrimitive.Title className="text-[15px] font-semibold tracking-[-0.015em]">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="mt-1 text-xs text-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="-mr-1.5 rounded-md p-1.5 text-faint transition-colors hover:bg-hover hover:text-fg"><X className="size-4" /></DialogPrimitive.Close>
        </div>
        <div className="max-h-[72vh] overflow-y-auto px-5 pb-5 pt-3">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
