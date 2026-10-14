import { cn } from '@/lib/utils';

/** Linear list view: 36px rows, hairline separators, quiet header. */
export function Table({ children }: { children: React.ReactNode }) {
  return <table className="w-full border-separate border-spacing-0 text-[13px]">{children}</table>;
}
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn('sticky top-0 z-10 h-8 border-b border-line bg-panel/95 px-3 text-left text-xs font-medium text-muted backdrop-blur first:pl-6 last:pr-6', className)}>{children}</th>;
}
export function Tr({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) {
  return <tr onClick={onClick} className={cn('group h-9 transition-colors duration-100 [&>td]:border-b [&>td]:border-line', onClick ? 'cursor-default hover:bg-hover' : '', className)}>{children}</tr>;
}
export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn('px-3 align-middle first:pl-6 last:pr-6', className)}>{children}</td>;
}
