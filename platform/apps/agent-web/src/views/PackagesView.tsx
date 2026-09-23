import { useEffect, useRef, useState } from 'react'

import { useFeedback } from '../components/Feedback'
import {
  Badge,
  Button,
  ConfirmButton,
  EmptyState,
  ErrorBanner,
  Field,
  KeyValue,
  LoadingBlock,
  Modal,
  Select,
  TextInput,
  TopbarActions,
  type BadgeTone,
} from '../components/ui'
import { useLocale } from '../i18n'
import {
  createApp,
  createReleaseFromFiles,
  deleteApp,
  getApp,
  listApps,
  startPackageRun,
  uploadReleaseArchive,
} from '../lib/api/apps'
import { ApiError, toUserMessage, type ApiCtx } from '../lib/api/client'
import type { AppDetail, AppListItem, ManifestInput, ManifestTask } from '../lib/api/types'
import { formatBytes, formatFullTime, formatListTime } from '../lib/format'
import { navigate, workspaceHref } from '../lib/router'

import './PackagesView.css'

const APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/
const ARCHIVE_NAME_PATTERN = /\.(tar\.gz|tgz|tar|zip|gz)$/i
const ARCHIVE_MAX_BYTES = 8 * 1024 * 1024
const DASH = '—'

interface ExampleAppDef {
  appId: string
  name: string
  description: string
  files: Record<string, string>
}

const GITHUB_TRENDING_YAML = `schemaVersion: '2'
id: github-trending
version: 0.1.0
description: Reads the real GitHub trending snapshot and produces an interpretation report.
entry: prompts/system.md
modelRoute:
  provider: any
  model: any
inputs:
  - name: language
    type: string
    required: false
tasks:
  - name: report
`

const GITHUB_TRENDING_PROMPT = `# github-trending

You are the GitHub Trending interpreter. A real trending snapshot is injected into the run input when available.

1. Summarize the overall landscape: dominant languages, heat level, and the strongest growth signals.
2. Interpret each repository in the snapshot with a one-line positioning, a highlight, and a trend signal. If the \`language\` param is provided, only interpret repositories of that language.
3. Only interpret repositories present in the snapshot; state missing dimensions explicitly.
4. Finish with a de-hyped takeaway: what direction these projects point to, and what may be short-term noise.
`

const FINANCE_BRIEFING_YAML = `schemaVersion: '2'
id: finance-briefing
version: 0.1.0
description: Reads exchange-rate and index snapshots and produces a finance briefing.
entry: prompts/system.md
modelRoute:
  provider: any
  model: any
inputs:
  - name: focus
    type: string
    required: false
    enum: [macro, equities]
tasks:
  - name: brief
`

const FINANCE_BRIEFING_PROMPT = `# finance-briefing

You are the finance briefing writer. Exchange-rate and index snapshots are injected into the run input when available.

1. Lead with the snapshot window and the data sources used.
2. Summarize FX moves and index performance, using snapshot numbers only.
3. Add a short interpretation: with \`focus=macro\` weight macro drivers; with \`focus=equities\` weight index breadth and movers.
4. Never invent numbers; state missing data explicitly.
`

const LIFECYCLE_PROBE_YAML = `schemaVersion: '2'
id: lifecycle-probe
version: 0.1.0
description: Lifecycle pipeline probe with no inputs and fixed output.
entry: prompts/system.md
modelRoute:
  provider: any
  model: any
tasks:
  - name: probe
`

const LIFECYCLE_PROBE_PROMPT = `# lifecycle-probe

You are the lifecycle pipeline probe. You take no inputs and produce a fixed output.

Whatever you receive, reply with exactly this self-check report and nothing else:

# lifecycle-probe self-check

- id: lifecycle-probe
- version: 0.1.0
- mode: self-contained
- input-dependencies: none

probe-ok
`

const EXAMPLE_APPS: readonly ExampleAppDef[] = [
  {
    appId: 'github-trending',
    name: 'GitHub Trending',
    description: 'Reads the real GitHub trending snapshot and produces an interpretation report.',
    files: {
      'app.yaml': GITHUB_TRENDING_YAML,
      'prompts/system.md': GITHUB_TRENDING_PROMPT,
    },
  },
  {
    appId: 'finance-briefing',
    name: 'Finance Briefing',
    description: 'Reads exchange-rate and index snapshots and produces a finance briefing.',
    files: {
      'app.yaml': FINANCE_BRIEFING_YAML,
      'prompts/system.md': FINANCE_BRIEFING_PROMPT,
    },
  },
  {
    appId: 'lifecycle-probe',
    name: 'Lifecycle Probe',
    description: 'Lifecycle pipeline probe with no inputs and fixed output.',
    files: {
      'app.yaml': LIFECYCLE_PROBE_YAML,
      'prompts/system.md': LIFECYCLE_PROBE_PROMPT,
    },
  },
]

type DetailState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'notFound' }
  | { status: 'ready'; app: AppDetail }

function taskLabel(task: ManifestTask | undefined): string | undefined {
  if (!task) return undefined
  if (typeof task.name === 'string' && task.name) return task.name
  if (typeof task.task === 'string' && task.task) return task.task
  return undefined
}

function statusTone(status: string | undefined): BadgeTone {
  if (status === 'active') return 'succeeded'
  if (status === 'deleted') return 'cancelled'
  return 'neutral'
}

function releasedVersion(result: unknown): string {
  if (result && typeof result === 'object') {
    const value = (result as Record<string, unknown>).packageVersion
    if (typeof value === 'string' && value) return value
  }
  return DASH
}

export function PackagesView({ api, packageId }: { api: ApiCtx; packageId?: string }) {
  const { t, locale } = useLocale()
  const feedback = useFeedback()

  const [listState, setListState] = useState<{ loading: boolean; error: string | null; apps: AppListItem[] }>({
    loading: true,
    error: null,
    apps: [],
  })
  const [detailState, setDetailState] = useState<DetailState>({ status: 'idle' })
  const [listTick, setListTick] = useState(0)
  const [detailTick, setDetailTick] = useState(0)

  const [createOpen, setCreateOpen] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)

  // 列表模式：加载 / 重新加载 App 列表；切到详情或重试时作废旧请求。
  useEffect(() => {
    if (packageId) return
    const controller = new AbortController()
    setListState({ loading: true, error: null, apps: [] })
    listApps(api, controller.signal).then(
      (apps) => {
        if (controller.signal.aborted) return
        setListState({ loading: false, error: null, apps })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setListState({ loading: false, error: toUserMessage(error), apps: [] })
      },
    )
    return () => controller.abort()
  }, [api, packageId, listTick])

  // 详情模式：packageId 变化时作废旧请求重新加载；从有到无时清空详情状态。
  useEffect(() => {
    if (!packageId) {
      setDetailState({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    setDetailState({ status: 'loading' })
    getApp(api, packageId, controller.signal).then(
      (app) => {
        if (controller.signal.aborted) return
        setDetailState(app ? { status: 'ready', app } : { status: 'notFound' })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 404) {
          setDetailState({ status: 'notFound' })
        } else {
          setDetailState({ status: 'error', message: toUserMessage(error) })
        }
      },
    )
    return () => controller.abort()
  }, [api, packageId, detailTick])

  const refreshList = async () => {
    try {
      const apps = await listApps(api)
      setListState({ loading: false, error: null, apps })
    } catch {
      // 刷新失败不阻断跳转；返回列表时加载 effect 会重新请求。
    }
  }

  const submitCreate = async (input: { appId: string; name: string; description?: string }) => {
    if (createBusy) return
    setCreateBusy(true)
    try {
      await createApp(api, input)
      setCreateOpen(false)
      await refreshList()
      navigate(workspaceHref({ view: 'packages', package: input.appId }))
    } catch (error) {
      feedback.error(t('packages.createFailed'), { body: toUserMessage(error) })
    } finally {
      setCreateBusy(false)
    }
  }

  const importExample = async (example: ExampleAppDef) => {
    if (importingId) return
    setImportingId(example.appId)
    try {
      try {
        await createApp(api, { appId: example.appId, name: example.name, description: example.description })
      } catch (error) {
        const alreadyExists =
          error instanceof ApiError && (error.status === 409 || error.code === 'APP_ALREADY_EXISTS')
        if (!alreadyExists) throw error
      }
      await createReleaseFromFiles(api, example.appId, example.files)
      await refreshList()
      navigate(workspaceHref({ view: 'packages', package: example.appId }))
    } catch (error) {
      feedback.error(t('packages.examples.failed'), { body: toUserMessage(error) })
    } finally {
      setImportingId(null)
    }
  }

  const removeApp = async (appId: string) => {
    if (deleteBusy) return
    setDeleteBusy(true)
    try {
      await deleteApp(api, appId)
      feedback.success(t('packages.detail.deleted'))
      navigate(workspaceHref({ view: 'packages' }))
    } catch (error) {
      feedback.error(t('packages.detail.deleteFailed'), { body: toUserMessage(error) })
    } finally {
      setDeleteBusy(false)
    }
  }

  // 三段式：列表栏常驻（aside），内容区随 package= 切换；创建 Modal 在共同父节点挂载。
  return (
    <div className="view packages-view">
      <TopbarActions>
        <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          {t('packages.create')}
        </Button>
      </TopbarActions>
      <aside className="pkg-list-pane">
        {listState.loading && <LoadingBlock title={t('common.loading')} />}
        {!listState.loading && listState.error && (
          <ErrorBanner
            title={t('packages.listLoadFailed')}
            body={listState.error}
            onRetry={() => setListTick((n) => n + 1)}
            retryLabel={t('common.retry')}
          />
        )}
        {!listState.loading && !listState.error && listState.apps.length === 0 && (
          <EmptyState title={t('packages.empty.title')} description={t('packages.empty.body')} />
        )}
        {!listState.loading && !listState.error && listState.apps.length > 0 && (
          <div className="pkg-list" role="list">
            {listState.apps.map((app) => (
              <a
                key={app.packageId}
                role="listitem"
                className={`pkg-row pane-item${packageId === app.packageId ? ' is-current' : ''}`}
                aria-current={packageId === app.packageId ? 'true' : undefined}
                href={workspaceHref({ view: 'packages', package: app.packageId })}
              >
                <span className="pkg-row-main">
                  <span className="pkg-row-name">{app.name}</span>
                  <span className="mono pkg-row-id">{app.packageId}</span>
                </span>
                <span className="pkg-row-meta">
                  <span className="pkg-row-releases">
                    {app.releaseCount} {t('packages.detail.releases')}
                  </span>
                  <span className="pkg-row-version">
                    {t('packages.detail.manifestVersion')} {app.latestVersion ?? DASH}
                  </span>
                  <span className="pkg-row-time">
                    {app.updatedAt ? formatListTime(app.updatedAt) : DASH}
                  </span>
                </span>
              </a>
            ))}
          </div>
        )}
        <ExamplesBlock importingId={importingId} onImport={(example) => void importExample(example)} />
      </aside>
      <div className="pkg-detail">
        {/* 三段式契约：未选中条目时列表栏常驻，内容区给引导空态 */}
        {!packageId && <EmptyState title={t('packages.detail.selectPrompt')} />}
        {detailState.status === 'loading' && <LoadingBlock title={t('common.loading')} />}
        {detailState.status === 'error' && (
          <ErrorBanner
            title={t('packages.detail.loadFailed')}
            body={detailState.message}
            onRetry={() => setDetailTick((n) => n + 1)}
            retryLabel={t('common.retry')}
          />
        )}
        {detailState.status === 'notFound' && <EmptyState title={t('packages.detail.notFound')} />}
        {detailState.status === 'ready' && (
          <>
            <div className="pkg-detail-head">
              <div className="pkg-detail-title">
                <h2 className="pkg-detail-name">{detailState.app.name}</h2>
                <span className="mono pkg-detail-id">{detailState.app.appId}</span>
                <Badge tone={statusTone(detailState.app.status)}>
                  {detailState.app.status ?? t('common.unknown')}
                </Badge>
                <span className="pkg-detail-created">
                  {detailState.app.createdAt ? formatFullTime(detailState.app.createdAt, locale) : DASH}
                </span>
              </div>
              <ConfirmButton
                danger
                label={t('packages.detail.delete')}
                confirmLabel={t('packages.detail.deleteConfirm')}
                busy={deleteBusy}
                onConfirm={() => void removeApp(detailState.app.appId)}
              />
            </div>
            {detailState.app.description && <p className="pkg-desc">{detailState.app.description}</p>}
            <div className="pkg-panels">
              <UploadPanel api={api} app={detailState.app} onUploaded={() => setDetailTick((n) => n + 1)} />
              <RunPanel key={detailState.app.appId} api={api} app={detailState.app} />
            </div>
            <ManifestCard app={detailState.app} />
            <AssetsCard app={detailState.app} />
            <ReleasesCard app={detailState.app} />
          </>
        )}
      </div>
      {createOpen && (
        <CreateAppModal
          busy={createBusy}
          onCancel={() => setCreateOpen(false)}
          onSubmit={(input) => void submitCreate(input)}
        />
      )}
    </div>
  )
}

function ExamplesBlock({
  importingId,
  onImport,
}: {
  importingId: string | null
  onImport: (example: ExampleAppDef) => void
}) {
  const { t } = useLocale()
  return (
    <section className="pkg-examples">
      <h2 className="pkg-section-title">{t('packages.examples.title')}</h2>
      <div className="pkg-example-grid">
        {EXAMPLE_APPS.map((example) => {
          const importing = importingId === example.appId
          return (
            <div key={example.appId} className="card pkg-example-card">
              <div className="pkg-example-head">
                <strong>{example.name}</strong>
                <span className="mono pkg-example-id">{example.appId}</span>
              </div>
              <p className="pkg-example-desc">{example.description}</p>
              <Button
                size="sm"
                variant="primary"
                loading={importing}
                disabled={importingId !== null && !importing}
                onClick={() => onImport(example)}
              >
                {importing ? t('packages.examples.importing') : t('packages.examples.import')}
              </Button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function CreateAppModal({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean
  onCancel: () => void
  onSubmit: (input: { appId: string; name: string; description?: string }) => void
}) {
  const { t } = useLocale()
  const [draft, setDraft] = useState({ appId: '', name: '', description: '' })
  const [errors, setErrors] = useState<{ appId?: string; name?: string }>({})

  const submit = () => {
    const appId = draft.appId.trim()
    const name = draft.name.trim()
    const description = draft.description.trim()
    const nextErrors: { appId?: string; name?: string } = {}
    if (!appId) nextErrors.appId = t('packages.form.validation.appIdRequired')
    else if (!APP_ID_PATTERN.test(appId)) nextErrors.appId = t('packages.form.validation.appIdInvalid')
    if (!name) nextErrors.name = t('packages.form.validation.nameRequired')
    setErrors(nextErrors)
    if (nextErrors.appId || nextErrors.name) return
    onSubmit({ appId, name, ...(description ? { description } : {}) })
  }

  return (
    <Modal
      title={t('packages.form.title')}
      onClose={() => { if (!busy) onCancel() }}
      dirty={draft.appId !== '' || draft.name !== '' || draft.description !== ''}
    >
      <Field
        label={t('packages.form.appId')}
        htmlFor="pkg-create-appid"
        hint={t('packages.form.appIdHint')}
        error={errors.appId}
      >
        <TextInput
          id="pkg-create-appid"
          value={draft.appId}
          maxLength={128}
          onChange={(event) => setDraft((d) => ({ ...d, appId: event.target.value }))}
        />
      </Field>
      <Field label={t('packages.form.name')} htmlFor="pkg-create-name" error={errors.name}>
        <TextInput
          id="pkg-create-name"
          value={draft.name}
          maxLength={128}
          onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
        />
      </Field>
      <Field label={t('packages.form.description')} htmlFor="pkg-create-desc">
        <textarea
          id="pkg-create-desc"
          className="input"
          rows={4}
          maxLength={2048}
          value={draft.description}
          onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))}
        />
      </Field>
      <div className="pkg-modal-foot">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" loading={busy} onClick={submit}>
          {t('packages.form.submit')}
        </Button>
      </div>
    </Modal>
  )
}

function UploadPanel({ api, app, onUploaded }: { api: ApiCtx; app: AppDetail; onUploaded: () => void }) {
  const { t } = useLocale()
  const feedback = useFeedback()
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (busy) return
    if (!file) {
      setError(t('packages.upload.fileRequired'))
      return
    }
    if (file.size > ARCHIVE_MAX_BYTES) {
      setError(t('packages.upload.fileTooBig'))
      return
    }
    if (!ARCHIVE_NAME_PATTERN.test(file.name)) {
      setError(t('packages.upload.fileBadName'))
      return
    }
    setBusy(true)
    try {
      const result = await uploadReleaseArchive(api, app.appId, file)
      feedback.success(t('packages.upload.uploaded', { version: releasedVersion(result) }))
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      onUploaded()
    } catch (err) {
      feedback.error(t('packages.upload.failed'), { body: toUserMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card pkg-card">
      <h2>{t('packages.upload.title')}</h2>
      <div className="pkg-upload-row">
        <input
          ref={fileRef}
          type="file"
          className="pkg-file-input"
          accept=".tar.gz,.tgz,.tar,.zip,.gz"
          aria-label={t('packages.upload.choose')}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            setError(null)
          }}
        />
        <Button size="sm" variant="primary" loading={busy} onClick={() => void submit()}>
          {t('packages.upload.submit')}
        </Button>
      </div>
      <p className="pkg-hint">{t('packages.upload.hint')}</p>
      {file && (
        <p className="pkg-file-name">
          {file.name} ({formatBytes(file.size)})
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function RunPanel({ api, app }: { api: ApiCtx; app: AppDetail }) {
  const { t } = useLocale()
  const feedback = useFeedback()
  const manifest = app.manifest
  const tasks = manifest?.tasks ?? []
  const inputs: readonly ManifestInput[] = manifest?.inputs ?? []
  const firstReleaseId = app.releases?.[0]?.releaseId
  const canRun = typeof firstReleaseId === 'string' && firstReleaseId !== ''

  const [taskName, setTaskName] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [paramErrors, setParamErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  // manifest 变化（如上传新版本后刷新）时重置运行表单。
  useEffect(() => {
    setTaskName(taskLabel(tasks[0]) ?? '')
    setValues({})
    setParamErrors({})
    // tasks/inputs 均派生自 manifest；以 manifest 身份作为重置依据。
  }, [app.appId, manifest])

  const start = async () => {
    const releaseId = firstReleaseId
    if (busy || !releaseId) return
    const params: Record<string, string | number> = {}
    const errors: Record<string, string> = {}
    for (const input of inputs) {
      const raw = (values[input.name] ?? '').trim()
      if (raw === '') continue
      if (input.type === 'number') {
        const num = Number(raw)
        if (!Number.isFinite(num)) {
          errors[input.name] = t('packages.run.paramNumberInvalid', { name: input.name })
          continue
        }
        params[input.name] = num
      } else {
        params[input.name] = raw
      }
    }
    setParamErrors(errors)
    if (Object.keys(errors).length > 0) return
    setBusy(true)
    try {
      const result = await startPackageRun(api, releaseId, { task: taskName || undefined, params })
      if (result?.taskId) {
        feedback.success(t('packages.run.started'), {
          action: { label: t('packages.run.openTask'), href: workspaceHref({ view: 'tasks', task: result.taskId }) },
        })
      } else {
        feedback.success(t('packages.run.started'))
      }
    } catch (error) {
      feedback.error(t('packages.run.failed'), { body: toUserMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card pkg-card">
      <h2>{t('packages.run.title')}</h2>
      {!canRun && <p className="pkg-run-disabled">{t('packages.detail.noRelease')}</p>}
      {canRun && tasks.length > 1 && (
        <Field label={t('packages.run.task')} htmlFor="pkg-run-task">
          <Select id="pkg-run-task" value={taskName} onChange={(event) => setTaskName(event.target.value)}>
            {tasks.map((task, index) => {
              const label = taskLabel(task) ?? String(index + 1)
              return (
                <option key={`${index}-${label}`} value={taskLabel(task) ?? ''}>
                  {label}
                </option>
              )
            })}
          </Select>
        </Field>
      )}
      {canRun && inputs.length > 0 && <h3 className="pkg-subhead">{t('packages.run.inputs')}</h3>}
      {canRun &&
        inputs.map((input) => {
          const inputId = `pkg-run-input-${input.name}`
          const value = values[input.name] ?? ''
          const setValue = (next: string) => setValues((v) => ({ ...v, [input.name]: next }))
          return (
            <Field
              key={input.name}
              label={`${input.name}${input.required ? ' *' : ''}`}
              htmlFor={inputId}
              error={paramErrors[input.name]}
            >
              {input.enum && input.enum.length > 0 ? (
                <Select id={inputId} value={value} onChange={(event) => setValue(event.target.value)}>
                  <option value="">{t('packages.run.useDefault')}</option>
                  {input.enum.map((option) => (
                    <option key={String(option)} value={String(option)}>
                      {String(option)}
                    </option>
                  ))}
                </Select>
              ) : (
                <TextInput
                  id={inputId}
                  value={value}
                  inputMode={input.type === 'number' ? 'decimal' : undefined}
                  onChange={(event) => setValue(event.target.value)}
                />
              )}
            </Field>
          )
        })}
      <div className="pkg-run-actions">
        <Button variant="primary" size="sm" loading={busy} disabled={!canRun} onClick={() => void start()}>
          {busy ? t('packages.run.starting') : t('packages.run.start')}
        </Button>
      </div>
    </section>
  )
}

function ManifestCard({ app }: { app: AppDetail }) {
  const { t } = useLocale()
  const manifest = app.manifest
  if (!manifest) return null
  const modelRoute = manifest.modelRoute
  const skillRefs = manifest.skillRefs ?? []
  const capabilityRefs = manifest.capabilityRefs ?? []
  const manifestInputs = manifest.inputs ?? []
  const dataSources = manifest.dataSources ?? []
  const manifestTasks = manifest.tasks ?? []
  return (
    <section className="card pkg-card">
      <h2>{t('packages.detail.manifest')}</h2>
      <KeyValue label={t('packages.detail.manifestVersion')}>{manifest.version ?? DASH}</KeyValue>
      {manifest.description && (
        <KeyValue label={t('packages.form.description')}>{manifest.description}</KeyValue>
      )}
      <KeyValue label={t('packages.detail.manifestEntry')} mono>
        {manifest.entry ?? DASH}
      </KeyValue>
      <KeyValue label={t('packages.detail.manifestModel')}>
        {modelRoute ? `${modelRoute.provider ?? DASH}/${modelRoute.model ?? DASH}` : DASH}
      </KeyValue>
      {skillRefs.length > 0 && (
        <KeyValue label={t('packages.detail.manifestSkills')}>{skillRefs.join(', ')}</KeyValue>
      )}
      {capabilityRefs.length > 0 && (
        <KeyValue label={t('packages.detail.manifestCapabilities')}>{capabilityRefs.join(', ')}</KeyValue>
      )}
      {manifestInputs.length > 0 && (
        <>
          <h3 className="pkg-subhead">{t('packages.detail.manifestInputs')}</h3>
          <div className="table-scroll">
            <table className="data-table">
            <thead>
              <tr>
                <th>{t('packages.detail.table.name')}</th>
                <th>{t('packages.detail.table.type')}</th>
                <th>{t('packages.detail.table.required')}</th>
                <th>{t('packages.detail.table.enum')}</th>
                <th>{t('packages.detail.table.default')}</th>
              </tr>
            </thead>
            <tbody>
              {manifestInputs.map((input) => (
                <tr key={input.name}>
                  <td className="mono">{input.name}</td>
                  <td className="mono">{input.type}</td>
                  <td>{input.required ? '✓' : DASH}</td>
                  <td className="mono">{input.enum && input.enum.length > 0 ? input.enum.join(', ') : DASH}</td>
                  <td className="mono">
                    {input.default === undefined || input.default === '' ? DASH : String(input.default)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
        </>
      )}
      {dataSources.length > 0 && (
        <>
          <h3 className="pkg-subhead">{t('packages.detail.manifestDataSources')}</h3>
          <div className="table-scroll">
            <table className="data-table">
            <thead>
              <tr>
                <th>{t('packages.detail.table.name')}</th>
                <th>{t('packages.detail.table.definition')}</th>
              </tr>
            </thead>
            <tbody>
              {dataSources.map((source, index) => {
                const { name, ...rest } = source
                const key = typeof name === 'string' && name ? name : String(index)
                return (
                  <tr key={key}>
                    <td className="mono">{typeof name === 'string' && name ? name : DASH}</td>
                    <td>
                      <pre className="json-block">{JSON.stringify(rest)}</pre>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
            </div>
        </>
      )}
      {manifestTasks.length > 0 && (
        <>
          <h3 className="pkg-subhead">{t('packages.detail.manifestTasks')}</h3>
          <div className="table-scroll">
            <table className="data-table">
            <thead>
              <tr>
                <th>{t('packages.detail.table.name')}</th>
                <th>{t('packages.detail.table.entry')}</th>
              </tr>
            </thead>
            <tbody>
              {manifestTasks.map((task, index) => {
                const label = taskLabel(task)
                return (
                  <tr key={label ?? index}>
                    <td className="mono">{label ?? DASH}</td>
                    <td className="mono">{typeof task.entry === 'string' && task.entry ? task.entry : DASH}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
            </div>
        </>
      )}
    </section>
  )
}

function AssetsCard({ app }: { app: AppDetail }) {
  const { t } = useLocale()
  const assets = app.assets ?? []
  return (
    <section className="card pkg-card">
      <h2>{t('packages.detail.assets')}</h2>
      {assets.length === 0 && <p className="pkg-muted">{t('packages.detail.assetsEmpty')}</p>}
      {assets.map((asset) => (
        <div className="pkg-asset" key={asset.relativePath}>
          <div className="pkg-asset-head">
            <span className="mono pkg-asset-path">{asset.relativePath}</span>
            <Badge tone="plain">{asset.kind}</Badge>
            <span className="pkg-asset-bytes">{formatBytes(asset.bytes)}</span>
            <span className="mono pkg-digest" title={asset.digest}>
              {asset.digest}
            </span>
          </div>
          {asset.preview !== undefined ? (
            <details className="pkg-asset-preview">
              <summary>{t('common.viewDetail')}</summary>
              <pre>{asset.preview}</pre>
            </details>
          ) : (
            <p className="pkg-muted">{t('packages.detail.assetNoPreview')}</p>
          )}
        </div>
      ))}
    </section>
  )
}

function ReleasesCard({ app }: { app: AppDetail }) {
  const { t, locale } = useLocale()
  const releases = app.releases ?? []
  return (
    <section className="card pkg-card">
      <h2>{t('packages.detail.releases')}</h2>
      {releases.length === 0 ? (
        <p className="pkg-muted">{t('packages.detail.releasesEmpty')}</p>
      ) : (
        <div className="table-scroll">
            <table className="data-table">
          <thead>
            <tr>
              <th>{t('packages.detail.table.version')}</th>
              <th>{t('packages.detail.table.compiler')}</th>
              <th>{t('packages.detail.table.digest')}</th>
              <th>{t('packages.detail.table.created')}</th>
            </tr>
          </thead>
          <tbody>
            {releases.map((release, index) => (
              <tr key={release.releaseId ?? release.contentDigest ?? `${release.packageVersion ?? 'release'}-${index}`}>
                <td className="mono">{release.packageVersion ?? DASH}</td>
                <td className="mono">{release.compilerBuild ?? DASH}</td>
                <td className="mono pkg-digest" title={release.contentDigest ?? ''}>
                  {release.contentDigest ?? DASH}
                </td>
                <td>{release.createdAt ? formatFullTime(release.createdAt, locale) : DASH}</td>
              </tr>
            ))}
          </tbody>
        </table>
            </div>
      )}
    </section>
  )
}
