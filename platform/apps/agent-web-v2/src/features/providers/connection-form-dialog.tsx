import { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { ModelCatalogItem, ProviderCatalogItem } from "@sage/app-contracts";
import type { ApiClient } from "@/lib/api";
import type { WorkspaceProviderView } from "@/types/workspace";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineNotice } from "@/components/feedback";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/features/chat/types";
import {
  applyModelIdEdit,
  applyModelSelection,
  applyProviderSelection,
  buildConnectionPayload,
  connectionFormFromView,
  emptyConnectionForm,
  validateConnectionForm,
  type ConnectionFormError,
  type ConnectionFormState,
} from "./logic";
import { useCatalogSearch } from "./use-catalog-search";
import { useCatalogSync } from "./use-catalog-sync";
import { CatalogCombobox } from "./catalog-combobox";

/**
 * Create/edit connection dialog (spec §8.2 "创建或编辑", §8.3): catalog-first
 * provider/model comboboxes prefill the form without overriding fields the
 * user edited manually; when the catalog is unavailable the form falls back
 * to fully manual input. Radix Dialog provides the modal semantics required
 * by §14.4 (focus moves in, Escape closes, Tab cycles, focus returns).
 *
 * The API key is write-only: it is only submitted on create, or on edit when
 * the user typed a new one (spec §8.2, §12.1).
 */

export type ConnectionDialogMode = { kind: "create" } | { kind: "edit"; connection: WorkspaceProviderView };

const FIELD_ERROR_KEYS: Record<ConnectionFormError, MessageKey> = {
  name: "providers.errorName",
  baseUrl: "providers.errorBaseUrl",
  modelId: "providers.errorModelId",
  apiKey: "providers.errorApiKey",
};

export function ConnectionFormDialog({
  client,
  mode,
  onClose,
  onSaved,
}: {
  client: ApiClient;
  mode: ConnectionDialogMode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const editing = mode.kind === "edit" ? mode.connection : null;
  const [form, setForm] = useState<ConnectionFormState>(() =>
    editing ? connectionFormFromView(editing) : emptyConnectionForm(),
  );
  const [fieldErrors, setFieldErrors] = useState<ConnectionFormError[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [selectedProviderName, setSelectedProviderName] = useState<string | null>(editing?.providerName ?? null);
  const [modelFocusSignal, setModelFocusSignal] = useState(0);

  const providerSearch = useCatalogSearch<ProviderCatalogItem>({
    client,
    path: "/provider-catalog/providers",
    keyOf: (provider) => provider.providerId,
  });
  const modelSearch = useCatalogSearch<ModelCatalogItem>({
    client,
    path: "/provider-catalog/models",
    keyOf: (model) => model.modelId,
    enabled: form.catalogProviderId !== null,
    extraParams: form.catalogProviderId ? { providerId: form.catalogProviderId, status: "all" } : undefined,
  });

  const sync = useCatalogSync(client, () => {
    providerSearch.reloadFirstPage();
    if (form.catalogProviderId) modelSearch.reloadFirstPage();
  });

  const catalogUnavailable = providerSearch.unavailable;

  const onSelectProvider = (provider: ProviderCatalogItem) => {
    setForm((state) => applyProviderSelection(state, provider));
    setSelectedProviderName(provider.name);
    modelSearch.reset();
    setModelFocusSignal((value) => value + 1);
  };

  const onSelectModel = (model: ModelCatalogItem) => {
    setForm((state) => applyModelSelection(state, selectedProviderName ?? state.providerName, model));
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    const errors = validateConnectionForm(form, mode.kind);
    setFieldErrors(errors);
    if (errors.length > 0) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const payload = buildConnectionPayload(form, mode.kind);
    const request = editing
      ? client.request<WorkspaceProviderView>(`/provider-connections/${encodeURIComponent(editing.id)}`, {
          method: "PUT",
          body: payload,
        })
      : client.request<WorkspaceProviderView>("/provider-connections", { method: "POST", body: payload });
    request
      .then(() => onSaved())
      .catch((err: unknown) => setSaveError(errorMessage(err, t("common.unknown"))))
      .finally(() => {
        savingRef.current = false;
        setSaving(false);
      });
  };

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent aria-label={t(editing ? "providers.editTitle" : "providers.createTitle")}>
        <DialogHeader>
          <DialogTitle>{t(editing ? "providers.editTitle" : "providers.createTitle")}</DialogTitle>
          <DialogDescription>{t("providers.viewLabel")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1" aria-label={t("providers.connectionsTitle")}>
          {catalogUnavailable ? (
            <InlineNotice variant="warning">{t("providers.catalogUnavailable")}</InlineNotice>
          ) : (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">Catalog</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={sync.syncing}
                  onClick={() => sync.start()}
                >
                  <RefreshCw aria-hidden="true" className={sync.syncing ? "animate-spin" : undefined} />
                  {sync.syncing ? t("providers.catalogRefreshing") : t("providers.catalogRefresh")}
                </Button>
              </div>
              {sync.error ? (
                <InlineNotice variant="error">
                  {sync.error.kind === "rate-limited"
                    ? t("providers.catalogRateLimited", { seconds: sync.error.retryAfterSeconds })
                    : sync.error.kind === "forbidden"
                      ? t("providers.catalogForbidden")
                      : t("providers.catalogSyncFailed", { message: sync.error.message })}
                </InlineNotice>
              ) : null}
              {providerSearch.snapshotChanged || modelSearch.snapshotChanged ? (
                <InlineNotice variant="info">{t("providers.catalogSnapshotChanged")}</InlineNotice>
              ) : null}
              <CatalogCombobox
                label={t("providers.catalogProviderLabel")}
                placeholder={t("providers.catalogProviderPlaceholder")}
                emptyText={t("providers.catalogEmpty")}
                query={providerSearch.query}
                onQueryChange={providerSearch.setQuery}
                items={providerSearch.items}
                loading={providerSearch.loading}
                loadingMore={providerSearch.loadingMore}
                hasMore={providerSearch.hasMore}
                onLoadMore={providerSearch.loadMore}
                keyOf={(provider) => provider.providerId}
                labelOf={(provider) => provider.name}
                onSelect={onSelectProvider}
              />
              {form.catalogProviderId ? (
                <CatalogCombobox
                  label={t("providers.catalogModelLabel")}
                  placeholder={t("providers.catalogModelPlaceholder")}
                  emptyText={t("providers.catalogEmpty")}
                  query={modelSearch.query}
                  onQueryChange={modelSearch.setQuery}
                  items={modelSearch.items}
                  loading={modelSearch.loading}
                  loadingMore={modelSearch.loadingMore}
                  hasMore={modelSearch.hasMore}
                  onLoadMore={modelSearch.loadMore}
                  keyOf={(model) => model.modelId}
                  labelOf={(model) => model.name}
                  onSelect={onSelectModel}
                  focusSignal={modelFocusSignal}
                />
              ) : (
                <p className="text-xs text-muted-foreground">{t("providers.catalogModelNeedProvider")}</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="connection-name">{t("providers.fieldName")}</Label>
            <Input
              id="connection-name"
              value={form.name}
              onChange={(event) => setForm((state) => ({ ...state, name: event.target.value, nameTouched: true }))}
            />
            {fieldErrors.includes("name") ? (
              <p role="alert" className="text-xs text-destructive">
                {t(FIELD_ERROR_KEYS.name)}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="connection-adapter">{t("providers.fieldAdapterKind")}</Label>
            <select
              id="connection-adapter"
              aria-label={t("providers.fieldAdapterKind")}
              value={form.adapterKind}
              onChange={(event) =>
                setForm((state) => ({
                  ...state,
                  adapterKind: event.target.value === "anthropic" ? "anthropic" : "openai-compatible",
                  adapterTouched: true,
                }))
              }
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="anthropic">{t("providers.adapterAnthropic")}</option>
              <option value="openai-compatible">{t("providers.adapterOpenaiCompatible")}</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="connection-base-url">{t("providers.fieldBaseUrl")}</Label>
            <Input
              id="connection-base-url"
              value={form.baseUrl}
              placeholder="https://"
              onChange={(event) =>
                setForm((state) => ({ ...state, baseUrl: event.target.value, baseUrlTouched: true }))
              }
            />
            {fieldErrors.includes("baseUrl") ? (
              <p role="alert" className="text-xs text-destructive">
                {t(FIELD_ERROR_KEYS.baseUrl)}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="connection-model-id">{t("providers.fieldModelId")}</Label>
            <Input
              id="connection-model-id"
              value={form.modelId}
              onChange={(event) => setForm((state) => applyModelIdEdit(state, event.target.value))}
            />
            {fieldErrors.includes("modelId") ? (
              <p role="alert" className="text-xs text-destructive">
                {t(FIELD_ERROR_KEYS.modelId)}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="connection-api-key">{t("providers.fieldApiKey")}</Label>
            <Input
              id="connection-api-key"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              onChange={(event) => setForm((state) => ({ ...state, apiKey: event.target.value }))}
            />
            {editing ? (
              <p className="text-xs text-muted-foreground">{t("providers.fieldApiKeyEditHint")}</p>
            ) : null}
            {fieldErrors.includes("apiKey") ? (
              <p role="alert" className="text-xs text-destructive">
                {t(FIELD_ERROR_KEYS.apiKey)}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="connection-provider-name">{t("providers.fieldProviderName")}</Label>
            <Input
              id="connection-provider-name"
              value={form.providerName}
              onChange={(event) => setForm((state) => ({ ...state, providerName: event.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="connection-model-name">{t("providers.fieldModelName")}</Label>
            <Input
              id="connection-model-name"
              value={form.modelName}
              onChange={(event) => setForm((state) => ({ ...state, modelName: event.target.value }))}
            />
          </div>

          {saveError ? (
            <InlineNotice variant="error">
              {t("providers.saveFailed")}: {saveError}
            </InlineNotice>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
