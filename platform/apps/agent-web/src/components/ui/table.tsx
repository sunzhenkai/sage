import { cn } from '@/lib/utils';

export function Table({ children }: { children: React.ReactNode }) {
  return <table className="w-full border-collapse text-[13px]">{children}</table>;
}
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn('sticky top-0 z-10 h-8 border-b bg-bg px-3 text-left text-[11px] font-medium uppercase tracking-wide text-muted', className)}>{children}</th>;
}
export function Tr({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) {
  return <tr onClick={onClick} className={cn('h-9 border-b border-border/70 transition-colors', onClick ? 'cursor-pointer hover:bg-hover' : '', className)}>{children}</tr>;
}
export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn('px-3 align-middle', className)}>{children}</td>;
}
