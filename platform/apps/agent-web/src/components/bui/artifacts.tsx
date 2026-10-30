import { useQuery } from '@tanstack/react-query';
import { FileText, Folder } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CodeBlock } from '@/components/bui/code-block';
import { Quiet } from '@/components/layout/page';
import { ErrorState, Loading, Mono } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { base64ToBytes, bytesToText, isArchiveName, looksLikeText, unpackArchive, type ArchiveEntry } from '@/lib/archive';
import { useT } from '@/lib/i18n';
import type { TaskArtifact } from '@/lib/types';
import { cn } from '@/lib/utils';

function groupPaths(paths: string[]): [string, string[]][] {
  const map = new Map<string, string[]>();
  for (const path of paths) {
    const slash = path.lastIndexOf('/');
    const dir = slash === -1 ? '' : path.slice(0, slash);
    const list = map.get(dir) ?? [];
    list.push(path);
    map.set(dir, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function previewCode(name: string, bytes: Uint8Array): string {
  if (!looksLikeText(name, bytes)) return `<<binary ${bytes.byteLength} bytes>>`;
  const text = bytesToText(bytes);
  if (/\.json$/i.test(name)) {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
  }
  return text;
}

/** Flush, centered empty state for full-bleed panes (no card, no stray box). */
export function EmptyPane({ icon, title, children }: { icon?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon === undefined ? null : <div className="mb-1 text-faint [&>svg]:size-6">{icon}</div>}
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      {children === undefined ? null : <div className="max-w-xl text-[12.5px] text-ink-2">{children}</div>}
    </div>
  );
}

export function Artifacts({ taskId, live = false, fill = false, empty }: { taskId: string; live?: boolean; fill?: boolean; empty?: React.ReactNode }) {
  const t = useT();
  const artifacts = useQuery({
    queryKey: ['task', taskId, 'artifacts'],
    queryFn: () => api.tasks.artifacts(taskId),
    ...(live ? { refetchInterval: 5_000 } : {})
  });
  const list = artifacts.data?.artifacts ?? [];
  const [selectedId, setSelectedId] = useState<string>();
  const selected = list.find((item) => item.artifactId === selectedId) ?? list[0];
  const selectedIsArchive = selected !== undefined && isArchiveName(selected.name, selected.mediaType);

  useEffect(() => {
    if (list.length === 0) { setSelectedId(undefined); return; }
    if (selectedId !== undefined && list.some((item) => item.artifactId === selectedId)) return;
    const preferred = list.find((item) => !isArchiveName(item.name, item.mediaType)) ?? list[0];
    setSelectedId(preferred?.artifactId);
  }, [list, selectedId]);

  const content = useQuery({
    queryKey: ['task', taskId, 'artifact', selected?.artifactId],
    queryFn: () => api.tasks.artifact(taskId, selected!.artifactId),
    enabled: selected !== undefined,
    ...(live ? { refetchInterval: 5_000 } : {})
  });

  const [archivePath, setArchivePath] = useState<string>();
  const archiveQuery = useQuery({
    queryKey: ['task', taskId, 'artifact-archive', selected?.artifactId, content.dataUpdatedAt],
    enabled: selectedIsArchive && content.data?.content !== undefined && content.data.encoding === 'base64',
    queryFn: async (): Promise<ArchiveEntry[]> => unpackArchive(base64ToBytes(String(content.data!.content)))
  });

  useEffect(() => { setArchivePath(undefined); }, [selected?.artifactId]);
  useEffect(() => {
    const entries = archiveQuery.data;
    if (entries === undefined || entries.length === 0) return;
    if (archivePath !== undefined && entries.some((entry) => entry.name === archivePath)) return;
    setArchivePath(entries[0]!.name);
  }, [archiveQuery.data, archivePath]);

  const archiveEntries = archiveQuery.data ?? [];
  const archiveGroups = useMemo(() => groupPaths(archiveEntries.map((entry) => entry.name)), [archiveEntries]);
  const activeArchive = archiveEntries.find((entry) => entry.name === archivePath);
  const downloadHref = selected === undefined ? undefined
    : `/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(selected.artifactId)}?download=1`;

  if (artifacts.isLoading) return <Loading rows={3} />;
  if (artifacts.error) return <ErrorState error={artifacts.error} />;
  if (!list.length) {
    if (empty !== undefined) return <>{empty}</>;
    return fill ? <EmptyPane icon={<FileText />} title={t('tasks.artifacts.empty')} /> : <Quiet>{t('tasks.artifacts.empty')}</Quiet>;
  }

  return (
    <div className={cn('flex flex-col md:flex-row md:items-stretch', fill ? 'min-h-0 flex-1' : 'min-h-[min(70vh,640px)]')}>
      <div className="flex w-full shrink-0 flex-col border-b border-line md:w-72 md:self-stretch md:border-b-0 md:border-r">
        <div className="flex h-8 shrink-0 items-center border-b border-line px-3 text-[11px] font-medium uppercase tracking-wide text-faint">
          {t('tasks.artifacts.files', { count: list.length })}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {list.map((item) => (
            <ArtifactRow key={item.artifactId} item={item} active={item.artifactId === selected?.artifactId}
              onSelect={() => setSelectedId(item.artifactId)} />
          ))}
        </div>
      </div>
      <div className="flex min-h-[320px] min-w-0 flex-1 flex-col md:min-h-0">
        {selected === undefined ? (
          <p className="px-3 py-6 text-[12.5px] text-faint">{t('tasks.artifacts.select')}</p>
        ) : content.isLoading ? <Loading rows={4} /> : content.error ? <ErrorState error={content.error} /> : selectedIsArchive ? (
          archiveQuery.isLoading ? <Loading rows={4} /> : archiveQuery.error ? (
            <div className="flex flex-1 flex-col gap-3 p-3">
              <Quiet>{t('tasks.artifacts.archiveFailed')}</Quiet>
              {downloadHref ? <a className="text-[12.5px] text-accent-ink hover:underline" href={downloadHref}>{t('tasks.artifacts.download')}</a> : null}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col md:flex-row md:items-stretch">
              <div className="flex w-full shrink-0 flex-col border-b border-line md:w-56 md:self-stretch md:border-b-0 md:border-r">
                <div className="flex h-8 shrink-0 items-center gap-1.5 px-3 text-[11px] font-medium uppercase tracking-wide text-faint">
                  <Folder className="size-3.5" />{selected.name ?? 'archive'}
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                  {archiveGroups.length === 0 ? <p className="px-3 py-4 text-[12.5px] text-faint">{t('tasks.artifacts.archiveEmpty')}</p> : archiveGroups.map(([dir, paths]) => (
                    <div key={dir || '.'} className="flex flex-col">
                      <div className="flex h-8 items-center gap-1.5 px-3 text-[11px] font-medium uppercase tracking-wide text-faint">
                        <Folder className="size-3.5" />{dir === '' ? '/' : dir}
                      </div>
                      {paths.map((path) => {
                        const name = dir === '' ? path : path.slice(dir.length + 1);
                        const active = path === archivePath;
                        return (
                          <button key={path} type="button" aria-pressed={active} title={path} onClick={() => setArchivePath(path)}
                            className={cn('flex h-[38px] w-full items-center gap-2 px-3 text-left text-[13px] transition-colors duration-75', active ? 'bg-active text-ink' : 'text-ink-2 hover:bg-hover')}>
                            <FileText className="size-3.5 shrink-0 text-faint" /><span className="truncate">{name}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
                  <Mono className="truncate text-faint">{archivePath ?? '—'}</Mono>
                  {downloadHref ? <a className="shrink-0 text-[12px] text-accent-ink hover:underline" href={downloadHref}>{t('tasks.artifacts.download')}</a> : null}
                </div>
                {activeArchive === undefined ? (
                  <p className="px-3 py-6 text-[12.5px] text-faint">{t('tasks.artifacts.selectEntry')}</p>
                ) : (
                  <div className="min-h-0 flex-1 overflow-auto p-3">
                    <CodeBlock bare filename={activeArchive.name} language={/\.json$/i.test(activeArchive.name) ? 'json' : 'text'}
                      code={previewCode(activeArchive.name, activeArchive.bytes)} maxHeight="none" />
                  </div>
                )}
              </div>
            </div>
          )
        ) : (
          <>
            <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
              <Mono className="truncate text-faint">{selected.name ?? selected.artifactId}</Mono>
              {downloadHref ? <a className="shrink-0 text-[12px] text-accent-ink hover:underline" href={downloadHref}>{t('tasks.artifacts.download')}</a> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <CodeBlock bare filename={selected.name ?? selected.artifactId}
                language={/json/.test(String(selected.mediaType)) || /\.json$/i.test(String(selected.name)) ? 'json' : 'text'}
                code={content.data?.content !== undefined && content.data.encoding !== 'base64'
                  ? String(content.data.content)
                  : content.data?.content !== undefined && content.data.encoding === 'base64'
                    ? previewCode(String(selected.name ?? selected.artifactId), base64ToBytes(String(content.data.content)))
                    : JSON.stringify(content.data, null, 2)}
                maxHeight="none" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ArtifactRow({ item, active, onSelect }: { item: TaskArtifact; active: boolean; onSelect: () => void }) {
  const archive = isArchiveName(item.name, item.mediaType);
  return (
    <button type="button" aria-pressed={active} title={item.name ?? item.artifactId} onClick={onSelect}
      className={cn('flex h-[38px] w-full items-center gap-2 px-3 text-left text-[13px] transition-colors duration-75', active ? 'bg-active text-ink' : 'text-ink-2 hover:bg-hover')}>
      {archive ? <Folder className="size-3.5 shrink-0 text-faint" /> : <FileText className="size-3.5 shrink-0 text-faint" />}
      <span className="min-w-0 flex-1 truncate">{item.name ?? item.artifactId}</span>
      {item.sizeBytes !== undefined ? <span className="shrink-0 text-[11px] tabular-nums text-faint">{Math.max(1, Math.round(item.sizeBytes / 1024))} KB</span> : null}
    </button>
  );
}
