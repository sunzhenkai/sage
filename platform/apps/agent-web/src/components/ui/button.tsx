import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-[13px] font-medium leading-none tracking-[-0.01em] transition-[transform,background-color,color,box-shadow,opacity] duration-150 ease-out active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[14px] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-ink text-canvas shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:opacity-90',
        secondary: 'bg-surface text-ink shadow-btn hover:bg-inset',
        ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
        outline: 'bg-hover-2 text-ink hover:bg-line-strong',
        accent: 'bg-accent text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-accent-ink',
        danger: 'bg-surface text-red shadow-btn hover:bg-red-tint'
      },
      size: { default: 'h-[27px] px-3', sm: 'h-6 px-2.5 text-[12px] font-normal', icon: 'size-7 rounded-control', 'icon-sm': 'size-6 rounded-chip', lg: 'h-8 px-4' }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
);

export function Button({ className, variant, size, asChild = false, ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
