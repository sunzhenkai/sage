import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

import type { ModelCatalogItem, ProviderCatalogItem } from '@sage/app-contracts'

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
  Segmented,
  Select,
  SettingsListPortal,
  TextInput,
  TopbarActions,
} from '../components/ui'
import { useLocale, type TranslateFn } from '../i18n'
import { ApiError, toUserMessage, type ApiCtx } from '../lib/api/client'
import {
  createProviderConnection,
  deleteProviderConnection,
  getCatalogSyncStatus,
  getRunAgentSettings,
  listProviderConnections,
  saveRunAgentSettings,
  searchCatalogModels,
  searchCatalogProviders,
  startCatalogSync,
  updateProviderConnection,
  type SaveProviderConnectionInput,
} from '../lib/api/providers'
import type { RunAgentSettingsView, WorkspaceProviderView } from '../lib/api/types'
import { navigate, workspaceHref } from '../lib/router'

import './ProvidersView.css'

type CatalogItem = ProviderCatalogItem | ModelCatalogItem

function catalogKey(item: CatalogItem): string {
  return 'modelId' in item ? item.modelId : item.providerId
}

function mergeByKey<T>(prev: readonly T[], next: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set(prev.map(key))
  return [...prev, ...next.filter((item) => !seen.has(key(item)))]
}

export function ProvidersView({ api, connection, panel }: { api: ApiCtx; connection?: string; panel?: 'model' }) {
  const { locale, setLocale, t } = useLocale()
  const feedback = useFeedback()

  // ---- 8.1 默认运行模型 ----
  const [settings, setSettings] = useState<RunAgentSettingsView | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsVersion, setSettingsVersion] = useState(0)
  const [savingDefault, setSavingDefault] = useState(false)
  const savingDefaultRef = useRef(false)

  useEffect(() => {
    const ctrl = new AbortController()
    let alive = true
    setSettingsLoading(true)
    setSettingsError(null)
    getRunAgentSettings(api, ctrl.signal)
      .then((view) => {
        if (alive) setSettings(view)
      })
      .catch((error: unknown) => {
        if (alive) setSettingsError(toUserMessage(error))
      })
      .finally(() => {
        if (alive) setSettingsLoading(false)
      })
    return () => {
      alive = false
      ctrl.abort()
    }
  }, [api, locale, settingsVersion])

  const handleSelectDefault = async (id: string) => {
    if (!id) return
    if (savingDefaultRef.current) return
    savingDefaultRef.current = true
    setSavingDefault(true)
    try {
      const view = await saveRunAgentSettings(api, id)
      if (view) setSettings(view)
      feedback.success(t('providers.defaultModel.saved'))
    } catch (error: unknown) {
      feedback.error(t('providers.defaultModel.saveFailed'), { body: toUserMessage(error) })
    } finally {
      savingDefaultRef.current = false
      setSavingDefault(false)
    }
  }

  // ---- 8.2 connections 列表 ----
  const [connections, setConnections] = useState<WorkspaceProviderView[] | null>(null)
  const [connectionsLoading, setConnectionsLoading] = useState(true)
  const [connectionsError, setConnectionsError] = useState<string | null>(null)
  const [connectionsVersion, setConnectionsVersion] = useState(0)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const deletingRef = useRef(false)

  useEffect(() => {
    const ctrl = new AbortController()
    let alive = true
    setConnectionsLoading(true)
    setConnectionsError(null)
    listProviderConnections(api, ctrl.signal)
      .then((res) => {
        if (alive) setConnections(res?.connections ?? [])
      })
      .catch((error: unknown) => {
        if (alive) setConnectionsError(toUserMessage(error))
      })
      .finally(() => {
        if (alive) setConnectionsLoading(false)
      })
    return () => {
      alive = false
      ctrl.abort()
    }
  }, [api, locale, connectionsVersion])

  const handleDelete = async (target: WorkspaceProviderView) => {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeletingId(target.id)
    try {
      await deleteProviderConnection(api, target.id)
      feedback.success(t('providers.connections.deleted'))
      setConnectionsVersion((v) => v + 1)
      setSettingsVersion((v) => v + 1)
      // 删除的是当前选中项 → 清除选中（回列表态，不带失效参数）。
      if (connection === target.id) navigate(workspaceHref({ view: 'settings', tab: 'connections' }))
    } catch (error: unknown) {
      feedback.error(t('providers.connections.deleteFailed'), { body: toUserMessage(error) })
    } finally {
      deletingRef.current = false
      setDeletingId(null)
    }
  }

  // ---- 8.2 创建 / 编辑表单 ----
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null)
  const [editingConnection, setEditingConnection] = useState<WorkspaceProviderView | null>(null)

  const openCreate = () => {
    setEditingConnection(null)
    setFormMode('create')
  }

  const selectedConn = connection !== undefined && connections !== null
    ? connections.find((item) => item.id === connection) ?? null
    : null
  const showModelPanel = connection === undefined && panel === 'model'
  const isDefault = settings !== null && !settings.unset && settings.providerConnectionId !== undefined
    && settings.providerConnectionId === connection

  const listSegment = (
    <>
      <div className="providers-language">
        <span className="providers-language-label">{t('providers.language')}</span>
        <Segmented
          value={locale}
          onChange={setLocale}
          ariaLabel={t('providers.language')}
          options={[
            { value: 'zh-CN', label: '简体中文' },
            { value: 'en', label: 'English' },
          ]}
        />
      </div>
      <a
        className={`settings-pinned pane-item${showModelPanel ? ' is-current' : ''}`}
        aria-current={showModelPanel ? 'true' : undefined}
        href={workspaceHref({ view: 'settings', tab: 'connections', panel: 'model' })}
      >
        <span className="settings-pinned-title">{t('providers.defaultModel.title')}</span>
      </a>
      {connections !== null && connections.length > 0 && (
        <ul className="providers-connection-list">
          {connections.map((item) => {
            const isCurrent = connection === item.id
            return (
              <li key={item.id}>
                <a
                  className={`providers-conn-row pane-item${isCurrent ? ' is-current' : ''}`}
                  aria-current={isCurrent ? 'true' : undefined}
                  href={workspaceHref({ view: 'settings', tab: 'connections', connection: item.id })}
                >
                  <span className="providers-conn-name">{item.name}</span>
                  <span className="providers-conn-meta mono">
                    {item.providerName && item.modelName ? `${item.providerName} / ${item.modelName}` : item.modelId}
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      )}
      {connections !== null && connections.length === 0 && (
        <p className="settings-list-hint">{t('providers.connections.emptyHint')}</p>
      )}
    </>
  )

  // 层 3 内容区：连接详情 / 默认模型面板 / 选中引导空态（三者互斥）。
  let content: ReactNode
  if (connection !== undefined) {
    if (connectionsLoading) {
      content = <LoadingBlock title={t('common.loading')} />
    } else if (connectionsError) {
      content = (
        <ErrorBanner
          title={t('common.notAvailable')}
          body={connectionsError}
          onRetry={() => setConnectionsVersion((v) => v + 1)}
          retryLabel={t('common.retry')}
        />
      )
    } else if (selectedConn === null) {
      content = <EmptyState title={t('providers.connections.notFound')} />
    } else {
      content = (
        <ConnectionDetail
          connection={selectedConn}
          isDefault={isDefault}
          busy={deletingId === selectedConn.id}
          onEdit={() => {
            setEditingConnection(selectedConn)
            setFormMode('edit')
          }}
          onDelete={() => void handleDelete(selectedConn)}
          t={t}
        />
      )
    }
  } else if (showModelPanel) {
    if (settingsLoading) {
      content = <LoadingBlock title={t('common.loading')} />
    } else if (settingsError) {
      content = (
        <ErrorBanner
          title={t('common.notAvailable')}
          body={settingsError}
          onRetry={() => setSettingsVersion((v) => v + 1)}
          retryLabel={t('common.retry')}
        />
      )
    } else if (settings) {
      content = (
        <section className="card">
          <div className="providers-card-head">
            <h2>{t('providers.defaultModel.title')}</h2>
          </div>
          <DefaultModelSection settings={settings} saving={savingDefault} onSelect={(id) => void handleSelectDefault(id)} t={t} />
        </section>
      )
    } else {
      content = <ErrorBanner title={t('common.notAvailable')} />
    }
  } else {
    if (connectionsLoading) {
      content = <LoadingBlock title={t('common.loading')} />
    } else if (connectionsError) {
      content = (
        <ErrorBanner
          title={t('common.notAvailable')}
          body={connectionsError}
          onRetry={() => setConnectionsVersion((v) => v + 1)}
          retryLabel={t('common.retry')}
        />
      )
    } else {
      content = (
        <EmptyState
          title={t('providers.connections.selectPrompt')}
          action={
            <Button variant="primary" size="sm" onClick={openCreate}>
              {t('providers.connections.add')}
            </Button>
          }
        />
      )
    }
  }

  return (
    <>
      <TopbarActions>
        <Button variant="primary" size="sm" onClick={openCreate}>
          {t('providers.connections.add')}
        </Button>
      </TopbarActions>
      <SettingsListPortal>{listSegment}</SettingsListPortal>
      <div className="providers-detail">{content}</div>
      {formMode && (
        <ConnectionFormModal
          api={api}
          mode={formMode}
          connection={editingConnection}
          onClose={() => {
            setFormMode(null)
            setEditingConnection(null)
          }}
          onSaved={() => {
            feedback.success(t('common.saved'))
            setConnectionsVersion((v) => v + 1)
            setSettingsVersion((v) => v + 1)
          }}
        />
      )}
    </>
  )
}

// ---------- 8.1 默认模型区块 ----------

function DefaultModelSection({
  settings,
  saving,
  onSelect,
  t,
}: {
  settings: RunAgentSettingsView
  saving: boolean
  onSelect: (id: string) => void
  t: TranslateFn
}) {
  const current = !settings.unset && settings.providerConnectionId
    ? settings.providers.find((p) => p.id === settings.providerConnectionId)
    : undefined

  return (
    <div className="providers-default-model">
      {!settings.unset && current ? (
        current.available ? (
          <p className="providers-note providers-note-success" role="status">
            {t('providers.defaultModel.ready')}
          </p>
        ) : (
          <p className="providers-note providers-note-warning" role="alert">
            {t('providers.defaultModel.unavailable', { reason: current.reason ?? t('common.notAvailable') })}
          </p>
        )
      ) : (
        <p className="providers-note providers-note-warning" role="alert">
          {t('providers.defaultModel.unset')}
        </p>
      )}

      <Field label={t('providers.defaultModel.title')} htmlFor="providers-default-model-select">
        <Select
          id="providers-default-model-select"
          value={settings.unset ? '' : (settings.providerConnectionId ?? '')}
          disabled={saving}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="">{t('common.none')}</option>
          {settings.providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.available ? provider.name : `${provider.name}（${t('common.notAvailable')}）`}
            </option>
          ))}
        </Select>
      </Field>
      {saving && <p className="providers-note">{t('providers.defaultModel.saving')}</p>}

      <ul className="providers-availability">
        {settings.providers.map((provider) => (
          <li key={provider.id}>
            <span className="providers-availability-name">{provider.name}</span>
            <Badge tone={provider.available ? 'succeeded' : 'warning'}>
              {provider.available ? t('common.available') : t('common.notAvailable')}
            </Badge>
            {!provider.available && provider.reason && (
              <span className="providers-availability-reason">{provider.reason}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- 8.2 连接详情（层 3 内容区；编辑/删除动作随选中项呈现） ----------

function ConnectionDetail({
  connection,
  isDefault,
  busy,
  onEdit,
  onDelete,
  t,
}: {
  connection: WorkspaceProviderView
  isDefault: boolean
  busy: boolean
  onEdit: () => void
  onDelete: () => void
  t: TranslateFn
}) {
  const readonly = connection.source === 'deployment-env'
  const modelLabel = connection.providerName && connection.modelName
    ? `${connection.providerName} / ${connection.modelName}`
    : connection.modelId

  return (
    <section className="card">
      <div className="providers-card-head">
        <h2>{connection.name}</h2>
        {!readonly && (
          <div className="providers-connection-actions">
            <Button size="sm" variant="ghost" onClick={onEdit}>
              {t('providers.connections.edit')}
            </Button>
            <ConfirmButton
              label={t('providers.connections.delete')}
              confirmLabel={t('providers.connections.deleteConfirm')}
              danger
              busy={busy}
              onConfirm={onDelete}
            />
          </div>
        )}
      </div>

      <div className="providers-connection-title">
        <Badge tone="plain">{connection.adapterKind}</Badge>
        {connection.source === 'user' ? (
          <Badge tone="plain">{t('providers.connections.sourceUser')}</Badge>
        ) : (
          <>
            <Badge tone="plain">{t('providers.connections.sourceDeployment')}</Badge>
            <Badge tone="warning">{t('providers.connections.readonly')}</Badge>
          </>
        )}
        {connection.credentialPresent ? (
          <Badge tone="succeeded">{t('providers.connections.credentialPresent')}</Badge>
        ) : (
          <Badge tone="warning">{t('providers.connections.credentialMissing')}</Badge>
        )}
      </div>

      {isDefault && (
        <p className="providers-note providers-note-warning">{t('providers.connections.deleteAffectsDefault')}</p>
      )}

      <KeyValue label={t('providers.connections.baseUrl')} mono>
        {connection.baseUrl}
      </KeyValue>
      <KeyValue label={t('providers.connections.modelId')} mono>
        {modelLabel === connection.modelId ? connection.modelId : `${modelLabel} · ${connection.modelId}`}
      </KeyValue>
      {readonly && <p className="providers-note">{t('providers.connections.form.apiKeyEditPlaceholder')}</p>}
    </section>
  )
}

// ---------- 8.2 创建 / 编辑表单（含 8.3 catalog 辅助与 sync） ----------

interface FormErrors {
  name?: string
  baseUrl?: string
  modelId?: string
  apiKey?: string
}

function ConnectionFormModal({
  api,
  mode,
  connection,
  onClose,
  onSaved,
}: {
  api: ApiCtx
  mode: 'create' | 'edit'
  connection: WorkspaceProviderView | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLocale()
  const feedback = useFeedback()

  const [name, setName] = useState(connection?.name ?? '')
  const [adapterKind, setAdapterKind] = useState<'anthropic' | 'openai-compatible'>(
    connection?.adapterKind === 'anthropic' ? 'anthropic' : 'openai-compatible',
  )
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '')
  const [modelId, setModelId] = useState(connection?.modelId ?? '')
  const [apiKey, setApiKey] = useState('')
  const [providerName, setProviderName] = useState(connection?.providerName ?? '')
  const [modelName, setModelName] = useState(connection?.modelName ?? '')
  const [errors, setErrors] = useState<FormErrors>({})

  // catalog 选择状态；model combobox 以 selectedProviderId 为 key 重挂载，
  // 从而在切换 provider 时自然清空 model 查询与候选。
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [selectedProviderName, setSelectedProviderName] = useState('')
  const [catalogAvailable, setCatalogAvailable] = useState(true)
  const [catalogReloadToken, setCatalogReloadToken] = useState(0)

  // touched 标记：用户手工编辑过的 name / adapterKind / baseUrl 不被目录选择覆盖。
  const nameTouchedRef = useRef(false)
  const adapterTouchedRef = useRef(false)
  const baseUrlTouchedRef = useRef(false)

  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const handlePickProvider = (provider: ProviderCatalogItem) => {
    setSelectedProviderId(provider.providerId)
    setSelectedProviderName(provider.name)
    if (!adapterTouchedRef.current) {
      setAdapterKind(provider.providerId === 'anthropic' ? 'anthropic' : 'openai-compatible')
    }
    if (!nameTouchedRef.current) setName(provider.name)
  }

  const handlePickModel = (model: ModelCatalogItem) => {
    setModelId(model.modelId)
    setModelName(model.name)
    if (!baseUrlTouchedRef.current && model.effectiveBaseUrl) setBaseUrl(model.effectiveBaseUrl)
    if (!nameTouchedRef.current) setName(`${selectedProviderName} · ${model.name}`)
  }

  const handleSubmit = async () => {
    if (submittingRef.current) return
    const nextErrors: FormErrors = {}
    const trimmedName = name.trim()
    const trimmedBaseUrl = baseUrl.trim()
    const trimmedModelId = modelId.trim()
    const trimmedApiKey = apiKey.trim()
    if (!trimmedName) nextErrors.name = t('providers.connections.form.validation.nameRequired')
    if (!trimmedBaseUrl || !trimmedBaseUrl.startsWith('https://')) {
      nextErrors.baseUrl = t('providers.connections.form.validation.baseUrlRequired')
    }
    if (!trimmedModelId) nextErrors.modelId = t('providers.connections.form.validation.modelIdRequired')
    if (mode === 'create' && !trimmedApiKey) nextErrors.apiKey = t('providers.connections.form.validation.apiKeyRequired')
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const input: SaveProviderConnectionInput = {
      name: trimmedName,
      adapterKind,
      baseUrl: trimmedBaseUrl,
      modelId: trimmedModelId,
    }
    if (trimmedApiKey) input.apiKey = trimmedApiKey
    const trimmedProviderName = providerName.trim()
    const trimmedModelName = modelName.trim()
    if (trimmedProviderName) input.providerName = trimmedProviderName
    if (trimmedModelName) input.modelName = trimmedModelName

    submittingRef.current = true
    setSubmitting(true)
    try {
      if (mode === 'create') {
        await createProviderConnection(api, input)
      } else if (connection) {
        await updateProviderConnection(api, connection.id, input)
      }
      onSaved()
      onClose()
    } catch (error: unknown) {
      feedback.error(
        t(mode === 'create' ? 'providers.connections.form.createFailed' : 'providers.connections.form.updateFailed'),
        { body: toUserMessage(error) },
      )
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  // ---- 8.3 catalog sync ----
  const [syncing, setSyncing] = useState(false)
  const syncTimerRef = useRef<number | null>(null)
  const pollInFlightRef = useRef(false)

  const stopSyncPolling = useCallback(() => {
    if (syncTimerRef.current !== null) {
      window.clearInterval(syncTimerRef.current)
      syncTimerRef.current = null
    }
  }, [])

  useEffect(() => stopSyncPolling, [stopSyncPolling])

  const handleSync = async () => {
    if (syncing) return
    stopSyncPolling()
    setSyncing(true)
    let attemptId: string | undefined
    try {
      const attempt = await startCatalogSync(api)
      attemptId = attempt?.attemptId
    } catch (error: unknown) {
      setSyncing(false)
      if (error instanceof ApiError && error.status === 429) {
        feedback.error(t('providers.catalog.syncRateLimited', { seconds: error.retryAfterSeconds ?? 60 }))
      } else if (error instanceof ApiError && error.status === 403) {
        feedback.error(t('providers.catalog.syncForbidden'))
      } else {
        feedback.error(t('providers.catalog.syncFailed'), { body: toUserMessage(error) })
      }
      return
    }
    if (!attemptId) {
      setSyncing(false)
      return
    }
    const syncAttemptId = attemptId
    let polls = 0
    const pollOnce = async () => {
      if (pollInFlightRef.current) return
      pollInFlightRef.current = true
      try {
        const status = await getCatalogSyncStatus(api, syncAttemptId)
        polls += 1
        const terminal = status?.status === 'succeeded'
          || status?.status === 'not_modified'
          || status?.status === 'failed'
          || status?.status === 'cancelled'
        if (terminal || polls >= 10) {
          stopSyncPolling()
          setSyncing(false)
          if (status?.status === 'succeeded') {
            feedback.success(t('providers.catalog.syncSucceeded'))
          } else if (status?.status === 'not_modified') {
            feedback.info(t('providers.catalog.syncNotModified'))
          } else if (status?.status === 'failed') {
            feedback.error(t('providers.catalog.syncFailed'), { body: status?.errorCode })
          } else if (status?.status === 'cancelled') {
            feedback.info(t('providers.catalog.syncCancelled'))
          }
          if (terminal) setCatalogReloadToken((v) => v + 1)
        }
      } catch {
        polls += 1
        if (polls >= 10) {
          stopSyncPolling()
          setSyncing(false)
        }
      } finally {
        pollInFlightRef.current = false
      }
    }
    syncTimerRef.current = window.setInterval(() => {
      void pollOnce()
    }, 1000)
  }

  // 脏检查：任一字段偏离初始值即视为有未保存修改，Modal 遮罩不再关闭（Escape 仍可关）。
  const dirty =
    name !== (connection?.name ?? '') ||
    adapterKind !== (connection?.adapterKind === 'anthropic' ? 'anthropic' : 'openai-compatible') ||
    baseUrl !== (connection?.baseUrl ?? '') ||
    modelId !== (connection?.modelId ?? '') ||
    apiKey !== '' ||
    providerName !== (connection?.providerName ?? '') ||
    modelName !== (connection?.modelName ?? '')

  return (
    <Modal
      title={t(mode === 'create' ? 'providers.connections.form.createTitle' : 'providers.connections.form.editTitle')}
      onClose={onClose}
      dirty={dirty}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={submitting} onClick={() => void handleSubmit()}>
            {t('providers.connections.form.submit')}
          </Button>
        </>
      }
    >
      <div className="providers-form">
        <Field label={t('providers.connections.form.name')} htmlFor="conn-name" error={errors.name}>
          <TextInput
            id="conn-name"
            value={name}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              nameTouchedRef.current = true
              setName(event.target.value)
              setErrors((prev) => ({ ...prev, name: undefined }))
            }}
          />
        </Field>

        <div className="providers-form-grid">
          <Field label={t('providers.connections.adapter')} htmlFor="conn-adapter">
            <Select
              id="conn-adapter"
              value={adapterKind}
              onChange={(event) => {
                adapterTouchedRef.current = true
                setAdapterKind(event.target.value as 'anthropic' | 'openai-compatible')
              }}
            >
              <option value="anthropic">anthropic</option>
              <option value="openai-compatible">openai-compatible</option>
            </Select>
          </Field>
          <Field label={t('providers.connections.baseUrl')} htmlFor="conn-base-url" error={errors.baseUrl}>
            <TextInput
              id="conn-base-url"
              value={baseUrl}
              placeholder="https://"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                baseUrlTouchedRef.current = true
                setBaseUrl(event.target.value)
                setErrors((prev) => ({ ...prev, baseUrl: undefined }))
              }}
            />
          </Field>
        </div>

        <Field label={t('providers.connections.modelId')} htmlFor="conn-model-id" error={errors.modelId}>
          <TextInput
            id="conn-model-id"
            value={modelId}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setModelId(event.target.value)
              setModelName('')
              setErrors((prev) => ({ ...prev, modelId: undefined }))
            }}
          />
        </Field>

        <Field
          label={t('providers.connections.form.apiKey')}
          htmlFor="conn-api-key"
          error={errors.apiKey}
          hint={mode === 'edit' ? t('providers.connections.form.apiKeyEditPlaceholder') : undefined}
        >
          <TextInput
            id="conn-api-key"
            type="password"
            value={apiKey}
            autoComplete="off"
            placeholder={mode === 'create'
              ? t('providers.connections.form.apiKeyCreatePlaceholder')
              : t('providers.connections.form.apiKeyEditPlaceholder')}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setApiKey(event.target.value)
              setErrors((prev) => ({ ...prev, apiKey: undefined }))
            }}
          />
        </Field>

        <div className="providers-form-grid">
          <Field label={t('providers.connections.providerName')} htmlFor="conn-provider-name">
            <TextInput
              id="conn-provider-name"
              value={providerName}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setProviderName(event.target.value)}
            />
          </Field>
          <Field label={t('providers.connections.modelName')} htmlFor="conn-model-name">
            <TextInput
              id="conn-model-name"
              value={modelName}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setModelName(event.target.value)}
            />
          </Field>
        </div>

        <div className="providers-catalog">
          <CatalogCombobox
            api={api}
            kind="provider"
            placeholder={t('providers.catalog.searchProviders')}
            reloadToken={catalogReloadToken}
            onPickProvider={handlePickProvider}
            onAvailableChange={setCatalogAvailable}
          />
          <CatalogCombobox
            key={selectedProviderId ?? 'no-provider'}
            api={api}
            kind="model"
            providerId={selectedProviderId}
            placeholder={t('providers.catalog.searchModels')}
            reloadToken={catalogReloadToken}
            onPickModel={handlePickModel}
            onAvailableChange={setCatalogAvailable}
          />
          <div className="providers-catalog-foot">
            <Button size="sm" loading={syncing} disabled={syncing} onClick={() => void handleSync()}>
              {t('providers.catalog.sync')}
            </Button>
            {!catalogAvailable && (
              <p className="providers-note providers-note-warning" role="alert">
                {t('providers.catalog.unavailable')}
              </p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ---------- 8.3 catalog combobox ----------

function CatalogCombobox({
  api,
  kind,
  providerId,
  placeholder,
  reloadToken,
  onPickProvider,
  onPickModel,
  onAvailableChange,
}: {
  api: ApiCtx
  kind: 'provider' | 'model'
  providerId?: string | null
  placeholder: string
  reloadToken: number
  onPickProvider?: (provider: ProviderCatalogItem) => void
  onPickModel?: (model: ModelCatalogItem) => void
  onAvailableChange?: (available: boolean) => void
}) {
  const { t } = useLocale()
  const feedback = useFeedback()
  const listboxId = useId()
  const catalogOptionId = (item: CatalogItem) => `${listboxId}:${catalogKey(item)}`
  const rootRef = useRef<HTMLDivElement | null>(null)

  const [query, setQuery] = useState('')
  const [items, setItems] = useState<CatalogItem[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const seqRef = useRef(0)
  const skipSearchRef = useRef(false)

  const load = useCallback(
    async (cursor: string | null) => {
      if (kind === 'model' && !providerId) return
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      const seq = ++seqRef.current
      const append = cursor !== null
      if (append) setLoadingMore(true)
      else setLoading(true)
      try {
        const page = kind === 'provider'
          ? await searchCatalogProviders(api, query, cursor ?? undefined, ctrl.signal)
          : await searchCatalogModels(api, {
              providerId: providerId ?? '',
              query,
              cursor: cursor ?? undefined,
              signal: ctrl.signal,
            })
        if (ctrl.signal.aborted || seq !== seqRef.current) return
        const list: CatalogItem[] = page?.items ?? []
        setItems((prev) => (append ? mergeByKey(prev, list, catalogKey) : list))
        setNextCursor(page?.nextCursor ?? null)
        if (!append) setActiveIndex(-1)
        onAvailableChange?.(true)
      } catch (error: unknown) {
        if (ctrl.signal.aborted || seq !== seqRef.current) return
        if (error instanceof ApiError && error.status === 409) {
          // cursor / snapshot 变化：提示并重新加载第一页，不当致命错误。
          feedback.info(t('providers.catalog.updated'))
          void loadRef.current(null)
          return
        }
        if (!append) {
          setItems([])
          setNextCursor(null)
          setActiveIndex(-1)
          setOpen(false)
        }
        onAvailableChange?.(false)
      } finally {
        if (seq === seqRef.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [api, kind, providerId, query, feedback, t, onAvailableChange],
  )

  const loadRef = useRef(load)
  loadRef.current = load

  // 卸载时中止在途 catalog 请求。
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  // 输入防抖 250ms；providerId / reloadToken 变化时重新加载第一页。
  useEffect(() => {
    if (kind === 'model' && !providerId) {
      setItems([])
      setNextCursor(null)
      return
    }
    if (skipSearchRef.current) {
      skipSearchRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      void loadRef.current(null)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, providerId, kind, reloadToken])

  const pick = (item: CatalogItem) => {
    skipSearchRef.current = true
    setQuery(item.name)
    if (kind === 'provider' && !('modelId' in item)) onPickProvider?.(item)
    else if (kind === 'model' && 'modelId' in item) onPickModel?.(item)
    setOpen(false)
    setActiveIndex(-1)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      if (open && items.length > 0) {
        event.preventDefault()
        setActiveIndex((index) => Math.min(index + 1, items.length - 1))
      }
    } else if (event.key === 'ArrowUp') {
      if (open && items.length > 0) {
        event.preventDefault()
        setActiveIndex((index) => Math.max(index - 1, 0))
      }
    } else if (event.key === 'Enter') {
      if (open && activeIndex >= 0 && activeIndex < items.length) {
        event.preventDefault()
        pick(items[activeIndex])
      }
    } else if (event.key === 'Escape') {
      if (open) {
        // 阻止冒泡到 Modal 的 Escape 关闭逻辑。
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      }
    }
  }

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null
    if (nextTarget && rootRef.current?.contains(nextTarget)) return
    setOpen(false)
  }

  const disabled = kind === 'model' && !providerId

  return (
    <div className={`catalog-combobox${disabled ? ' is-disabled' : ''}`} ref={rootRef} onBlur={handleBlur}>
      <div className="catalog-combobox-input">
        <TextInput
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 && activeIndex < items.length ? catalogOptionId(items[activeIndex]) : undefined}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onKeyDown={handleKeyDown}
        />
        {loading && <span className="spinner spinner-inline" aria-hidden="true" />}
      </div>
      {open && !disabled && (
        <ul className="catalog-combobox-list" id={listboxId} role="listbox">
          {items.length === 0 && !loading ? (
            <li className="catalog-combobox-empty">{t('providers.catalog.noResults')}</li>
          ) : (
            items.map((item, index) => (
              <li
                key={catalogKey(item)}
                id={catalogOptionId(item)}
                role="option"
                aria-selected={index === activeIndex}
                className={`catalog-combobox-option${index === activeIndex ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  pick(item)
                }}
              >
                <CatalogItemRow item={item} />
              </li>
            ))
          )}
          {nextCursor && (
            <li className="catalog-combobox-more">
              <Button
                size="sm"
                variant="ghost"
                loading={loadingMore}
                disabled={loadingMore}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void loadRef.current(nextCursor)}
              >
                {t('providers.catalog.loadMore')}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function CatalogItemRow({ item }: { item: CatalogItem }) {
  if ('modelId' in item) {
    return (
      <span className="catalog-item">
        <span className="catalog-item-name">{item.name}</span>
        <span className="catalog-item-meta mono">{item.modelId}</span>
        <Badge tone={item.status === 'active' ? 'info' : 'warning'}>{item.status}</Badge>
      </span>
    )
  }
  return (
    <span className="catalog-item">
      <span className="catalog-item-name">{item.name}</span>
      <span className="catalog-item-meta mono">{item.providerId}</span>
    </span>
  )
}
