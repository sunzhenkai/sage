import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { Monitor, Moon, Plus, Search, Sun } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '@/lib/api';
import { updateSettings } from '@/lib/settings';
import { navItems } from './nav';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const sessions = useQuery({ queryKey: ['chat', 'sessions', 'palette'], queryFn: () => api.chat.listSessions({ limit: 20 }), enabled: open });
  const go = (fn: () => void) => { onOpenChange(false); fn(); };
  const item = 'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-fg data-[selected=true]:bg-hover [&_svg]:size-3.5 [&_svg]:text-muted';
  const group = '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-muted';
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[15vh] z-50 w-[min(620px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border bg-panel shadow-2xl outline-none">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Navigate and run commands</DialogPrimitive.Description>
          <Command loop>
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="size-4 text-muted" />
              <Command.Input autoFocus placeholder="Type a command or search…" className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
            </div>
            <Command.List className="max-h-[360px] overflow-y-auto p-1.5">
              <Command.Empty className="p-6 text-center text-xs text-muted">No results.</Command.Empty>
              <Command.Group heading="Navigation" className={group}>
                {navItems.map(({ to, label, icon: Icon, shortcut }) => (
                  <Command.Item key={to} value={`go ${label}`} onSelect={() => go(() => navigate(to))} className={item}>
                    <Icon />Go to {label}<span className="ml-auto font-mono text-[10px] text-muted">{shortcut}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Actions" className={group}>
                <Command.Item value="new chat session" onSelect={() => go(() => navigate('/chat?new=1'))} className={item}><Plus />New chat session</Command.Item>
                <Command.Item value="new schedule" onSelect={() => go(() => navigate('/schedules?new=1'))} className={item}><Plus />New schedule</Command.Item>
                <Command.Item value="theme light" onSelect={() => go(() => updateSettings({ theme: 'light' }))} className={item}><Sun />Theme: Light</Command.Item>
                <Command.Item value="theme dark" onSelect={() => go(() => updateSettings({ theme: 'dark' }))} className={item}><Moon />Theme: Dark</Command.Item>
                <Command.Item value="theme system" onSelect={() => go(() => updateSettings({ theme: 'system' }))} className={item}><Monitor />Theme: System</Command.Item>
              </Command.Group>
              {sessions.data?.items.length ? (
                <Command.Group heading="Recent sessions" className={group}>
                  {sessions.data.items.map((session) => (
                    <Command.Item key={session.sessionId} value={`session ${session.title ?? ''} ${session.sessionId}`} onSelect={() => go(() => navigate(`/chat/${session.sessionId}`))} className={item}>
                      <span className="truncate">{session.title ?? session.preview ?? session.sessionId}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
