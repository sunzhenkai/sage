import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const field = 'w-full rounded-md border bg-panel px-2.5 text-[13px] text-fg placeholder:text-muted/70 outline-none transition-colors focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-50';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(field, 'h-7', className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'py-1.5 resize-none', className)} {...props} />;
}
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(field, 'h-7 pr-6', className)} {...props} />;
}
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-xs font-medium text-muted', className)} {...props} />;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}
