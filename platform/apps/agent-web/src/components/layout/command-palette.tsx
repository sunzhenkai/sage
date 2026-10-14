import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { Monitor, Moon, Plus, Search, Sun } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '@/lib/api';
import { updateSettings } from '@/lib/settings';
import { Kbd } from '@/components/ui/misc';
import { navItems } from './nav';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const sessions = useQuery({ queryKey: ['chat', 'sessions', 'palette'], queryFn: () => api.chat.listSessions({ limit: 12 }), enabled: open });
  const go = (fn: () => void) => { onOpenChange(false); fn(); };
  const item = 'flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px] text-fg-2 outline-none data-[selected=true]:bg-hover data-[selected=true]:text-fg [&_svg]:size-[15px] [&_svg]:text-faint data-[selected=true]:[&_svg]:text-muted';
  const group = '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.04em] [&_[cmdk-group-heading]]:text-faint';
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-fade-in fixed inset-0 z-40 bg-scrim" />
        <DialogPrimitive.Content className="animate-pop-in fixed left-1/2 top-[14vh] z-50 w-[min(640px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl bg-raised shadow-pop outline-none">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Navigate and run commands</DialogPrimitive.Description>
          <Command loop>
            <div className="flex items-center gap-2.5 border-b border-line px-3.5">
              <Search className="size-4 text-faint" strokeWidth={1.75} />
              <Command.Input autoFocus placeholder="Type a command or search…" className="h-12 flex-1 bg-transparent text-[14px] tracking-[-0.01em] outline-none placeholder:text-faint" />
              <Kbd>esc</Kbd>
            </div>
            <Command.List className="max-h-[380px] overflow-y-auto p-1.5">
              <Command.Empty className="py-10 text-center text-xs text-muted">No results.</Command.Empty>
              <Command.Group heading="Navigation" className={group}>
                {navItems.map(({ to, label, icon: Icon, shortcut }) => (
                  <Command.Item key={to} value={`go ${label}`} onSelect={() => go(() => navigate(to))} className={item}>
                    <Icon strokeWidth={1.75} />Go to {label}
                    <span className="ml-auto flex gap-0.5">{shortcut.split(' ').map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Actions" className={group}>
                <Command.Item value="new chat session" onSelect={() => go(() => navigate('/chat?new=1'))} className={item}><Plus strokeWidth={1.75} />New chat session</Command.Item>
                <Command.Item value="new schedule" onSelect={() => go(() => navigate('/schedules?new=1'))} className={item}><Plus strokeWidth={1.75} />New schedule</Command.Item>
                <Command.Item value="theme light" onSelect={() => go(() => updateSettings({ theme: 'light' }))} className={item}><Sun strokeWidth={1.75} />Theme: Light</Command.Item>
                <Command.Item value="theme dark" onSelect={() => go(() => updateSettings({ theme: 'dark' }))} className={item}><Moon strokeWidth={1.75} />Theme: Dark</Command.Item>
                <Command.Item value="theme system" onSelect={() => go(() => updateSettings({ theme: 'system' }))} className={item}><Monitor strokeWidth={1.75} />Theme: System</Command.Item>
              </Command.Group>
              {sessions.data?.items.length ? (
                <Command.Group heading="Recent sessions" className={group}>
                  {sessions.data.items.map((session) => (
                    <Command.Item key={session.sessionId} value={`session ${session.title ?? ''} ${session.sessionId}`} onSelect={() => go(() => navigate(`/chat/${session.sessionId}`))} className={item}>
                      <span className="truncate">{session.title ?? session.preview ?? session.sessionId}</span>
                      <span className="ml-auto font-mono text-[11px] text-faint">{session.sessionId.slice(-8)}</span>
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
