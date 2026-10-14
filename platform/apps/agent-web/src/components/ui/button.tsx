import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[12.5px] font-medium tracking-[-0.01em] transition-[background-color,color,box-shadow,opacity] duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[14px] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(0_0_0/0.2)] hover:bg-accent-hover',
        secondary: 'border border-line-strong bg-raised text-fg-2 shadow-card hover:bg-hover hover:text-fg',
        ghost: 'text-muted hover:bg-hover hover:text-fg',
        outline: 'border border-line text-fg-2 hover:bg-hover hover:text-fg',
        danger: 'border border-red/30 bg-red/10 text-red hover:bg-red/15'
      },
      size: { default: 'h-7 px-2.5', sm: 'h-6 rounded-[5px] px-2 text-xs', icon: 'size-7', 'icon-sm': 'size-6 rounded-[5px]', lg: 'h-8 px-3.5 text-[13px]' }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
);

export function Button({ className, variant, size, asChild = false, ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
