import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { ErrorState, Mono } from '@/components/ui/misc';
import { ApiError, api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { isMock } from '@/lib/mock';
import type { AppManifest, AppRelease } from '@/lib/types';

export function RunReleaseDialog({ appId, release, manifest, onClose }: {
  appId: string;
  release: AppRelease | undefined;
  manifest: AppManifest | undefined;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={release !== undefined} onOpenChange={(open) => { if (!open) onClose(); }}>
      {release === undefined ? null : (
        <DialogContent title={t('apps.run.title', { app: appId })} description={t('apps.run.description', { version: release.packageVersion })}>
          <RunReleaseForm key={release.releaseId} appId={appId} release={release} manifest={manifest ?? release.manifest} onClose={onClose} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function RunReleaseForm({ appId, release, manifest, onClose }: {
  appId: string;
  release: AppRelease;
  manifest: AppManifest | undefined;
  onClose: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tasks = manifest?.tasks ?? [];
  const inputs = manifest?.inputs ?? [];
  const dataSources = manifest?.dataSources ?? [];
  const [task, setTask] = useState(tasks[0]?.name ?? '');
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(inputs.map((input) => [
    input.name,
    input.default === undefined ? '' : String(input.default)
  ])));
  const [validation, setValidation] = useState<string | undefined>();
  const [submitError, setSubmitError] = useState<unknown>();

  const run = useMutation({
    mutationFn: (params: Record<string, string | number>) => api.releases.run(release.releaseId, {
      ...(task === '' ? {} : { task }),
      ...(Object.keys(params).length === 0 ? {} : { params })
    }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['app', appId] }),
        queryClient.invalidateQueries({ queryKey: ['app-runs', appId] })
      ]);
      onClose();
      void navigate(`/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(result.taskId)}`);
    },
    onError: (error) => setSubmitError(error)
  });

  const buildParams = (): Record<string, string | number> | undefined => {
    const params: Record<string, string | number> = {};
    for (const input of inputs) {
      const raw = (values[input.name] ?? '').trim();
      if (raw === '') {
        if (input.required) {
          setValidation(t('apps.run.required', { name: input.name }));
          return undefined;
        }
        continue;
      }
      if (input.type === 'number') {
        const numeric = Number(raw);
        if (!Number.isFinite(numeric)) {
          setValidation(t('apps.run.number', { name: input.name }));
          return undefined;
        }
        params[input.name] = numeric;
        continue;
      }
      params[input.name] = raw;
    }
    return params;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setValidation(undefined);
    setSubmitError(undefined);
    const params = buildParams();
    if (params === undefined) return;
    run.mutate(params);
  };

  const providerMissing = submitError instanceof ApiError && submitError.code === 'PROVIDER_DEPENDENCY_MISSING';

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      {tasks.length > 0 ? (
        <Field label={t('apps.run.task')}>
          <Select value={task} onChange={(event) => setTask(event.target.value)}>
            {tasks.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </Select>
        </Field>
      ) : null}
      {inputs.map((input) => (
        <Field key={input.name} label={`${input.name}${input.required ? ' *' : ''}`} hint={input.type === 'number' ? t('apps.run.numberHint') : undefined}>
          {input.enum === undefined ? (
            <Input
              type={input.type === 'number' ? 'number' : 'text'}
              inputMode={input.type === 'number' ? 'decimal' : undefined}
              required={input.required}
              value={values[input.name] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [input.name]: event.target.value }))}
            />
          ) : (
            <Select
              required={input.required}
              value={values[input.name] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [input.name]: event.target.value }))}
            >
              <option value="">{t('apps.run.enumEmpty')}</option>
              {input.enum.map((value) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}
            </Select>
          )}
        </Field>
      ))}
      {dataSources.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-fg-2">{t('apps.run.dataSources')}</p>
          {dataSources.map((source) => (
            <div key={source.name} className="flex min-w-0 items-baseline gap-2 text-[12.5px]">
              <span className="shrink-0 text-muted">{source.name}</span>
              <Mono className="truncate text-faint">{source.url}</Mono>
            </div>
          ))}
          <p className="text-2xs leading-4 text-faint">{t('apps.run.dataSourcesHint')}</p>
        </div>
      ) : null}
      {validation === undefined ? null : <p className="text-[12.5px] text-red" role="alert">{validation}</p>}
      {submitError === undefined ? null : providerMissing ? (
        <p className="text-[12.5px] text-red" role="alert">
          {t('apps.run.providerMissing')}{' '}
          <Link className="text-accent-ink hover:underline" to="/providers" onClick={onClose}>{t('apps.run.openProviders')}</Link>
        </p>
      ) : <ErrorState error={submitError} />}
      {isMock() ? <p className="text-[12px] text-amber">{t('apps.run.mockDisabled')}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={run.isPending || isMock()}><Play />{run.isPending ? t('apps.run.starting') : t('apps.run.submit')}</Button>
      </div>
    </form>
  );
}
