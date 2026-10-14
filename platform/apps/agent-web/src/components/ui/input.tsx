import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const field = 'w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-fg placeholder:text-faint transition-[border-color,box-shadow] duration-150 hover:border-faint/60 focus:border-accent/70 focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:outline-none disabled:opacity-50';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(field, 'h-8', className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'resize-none py-2 leading-5', className)} {...props} />;
}
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(field, 'h-8 cursor-pointer appearance-none  pr-7', className)} style={{ backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '12px', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238b8f98' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")` }} {...props} />;
}
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-xs font-medium text-fg-2', className)} {...props} />;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-2xs leading-4 text-faint">{hint}</p> : null}
    </div>
  );
}
