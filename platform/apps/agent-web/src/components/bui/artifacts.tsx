import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CodeBlock } from '@/components/bui/code-block';
import { FileChip } from '@/components/bui/tool-chips';
import { Quiet } from '@/components/layout/page';
import { ErrorState, Loading } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

export function Artifacts({ taskId, live = false }: { taskId: string; live?: boolean }) {
  const t = useT();
  const artifacts = useQuery({
    queryKey: ['task', taskId, 'artifacts'],
    queryFn: () => api.tasks.artifacts(taskId),
    ...(live ? { refetchInterval: 5_000 } : {})
  });
  const [open, setOpen] = useState<string>();
  const content = useQuery({
    queryKey: ['task', taskId, 'artifact', open],
    queryFn: () => api.tasks.artifact(taskId, open ?? ''),
    enabled: !!open,
    ...(live ? { refetchInterval: 5_000 } : {})
  });
  if (artifacts.isLoading) return <Loading rows={3} />;
  if (artifacts.error) return <ErrorState error={artifacts.error} />;
  const list = artifacts.data?.artifacts ?? [];
  if (!list.length) return <Quiet>{t('tasks.artifacts.empty')}</Quiet>;
  const current = list.find((a) => a.artifactId === open);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {list.map((a) => (
          <FileChip key={a.artifactId} active={open === a.artifactId} onClick={() => setOpen(a.artifactId)} name={a.name ?? a.artifactId} meta={a.sizeBytes !== undefined ? `${Math.max(1, Math.round(a.sizeBytes / 1024))} KB` : undefined} />
        ))}
      </div>
      {open ? (content.isLoading ? <Loading rows={3} /> : content.error ? <ErrorState error={content.error} /> : (
        <CodeBlock filename={current?.name ?? open} language={/json/.test(String(current?.mediaType)) ? 'json' : 'text'}
          code={content.data?.content !== undefined && content.data.encoding !== 'base64' ? String(content.data.content) : JSON.stringify(content.data, null, 2)}
          actions={<a className="flex h-6 items-center rounded-[6px] px-1.5 text-[12px] font-medium text-ink-3 hover:bg-hover hover:text-ink" href={`/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(open)}?download=1`}>{t('tasks.artifacts.download')}</a>} />
      )) : <p className="text-[12.5px] text-ink-3">{t('tasks.artifacts.select')}</p>}
    </div>
  );
}
