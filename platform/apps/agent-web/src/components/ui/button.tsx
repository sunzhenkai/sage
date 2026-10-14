import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-fg hover:bg-accent/90 shadow-sm',
        secondary: 'border bg-panel text-fg hover:bg-hover shadow-xs',
        ghost: 'text-muted hover:bg-hover hover:text-fg',
        danger: 'bg-danger text-white hover:bg-danger/90'
      },
      size: { default: 'h-7 px-2.5', sm: 'h-6 px-2 text-xs', icon: 'size-7', lg: 'h-8 px-3' }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
);

export function Button({ className, variant, size, asChild = false, ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
