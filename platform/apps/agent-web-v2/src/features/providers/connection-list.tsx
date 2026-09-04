import { useState } from "react";
import { Pencil, Plug, Plus, Trash2 } from "lucide-react";
import type { WorkspaceProviderView } from "@/types/workspace";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Banner, EmptyPanel, LoadingState } from "@/components/feedback";
import { errorMessage } from "@/features/chat/types";

/**
 * Workspace provider connections (spec §8.2): each row shows the name, the
 * provider/model display names or model id, the source and the credential
 * presence. API keys are never rendered. `deployment-env` connections are
 * read-only; `user` connections can be edited or deleted with a two-step
 * confirmation (spec §8.2 "删除", §14.6 alert semantics).
 */
export function ConnectionList({
  connections,
  loading,
  error,
  defaultConnectionId,
  onAdd,
  onEdit,
  onDelete,
  onDeleted,
}: {
  connections: WorkspaceProviderView[];
  loading: boolean;
  error: unknown;
  defaultConnectionId?: string | undefined;
  onAdd: () => void;
  onEdit: (connection: WorkspaceProviderView) => void;
  onDelete: (id: string) => Promise<void>;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const confirmDelete = (connection: WorkspaceProviderView) => {
    setDeleting(true);
    setDeleteError(null);
    onDelete(connection.id)
      .then(() => {
        setConfirmingId(null);
        onDeleted();
      })
      .catch((err: unknown) => {
        // e.g. 409 PROVIDER_CONNECTION_IN_USE — show the server error (spec §8.2).
        setDeleteError(errorMessage(err, t("common.unknown")));
      })
      .finally(() => setDeleting(false));
  };

  return (
    <section aria-label={t("providers.connectionsTitle")} className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("providers.connectionsTitle")}</h2>
        <Button size="sm" onClick={onAdd}>
          <Plus aria-hidden="true" />
          {t("providers.addConnection")}
        </Button>
      </div>

      {loading ? (
        <LoadingState label={t("common.loading")} />
      ) : error ? (
        <Banner variant="error" title={t("providers.connectionsLoadFailed")}>
          {errorMessage(error, t("common.unknown"))}
        </Banner>
      ) : connections.length === 0 ? (
        <EmptyPanel title={t("providers.emptyConnections")} />
      ) : (
        <ul className="divide-y">
          {connections.map((connection) => {
            const confirming = confirmingId === connection.id;
            const isDefault = connection.id === defaultConnectionId;
            const subtitle = [connection.providerName, connection.modelName ?? connection.modelId]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={connection.id} className="space-y-2 py-3">
                <div className="flex items-center gap-2">
                  <Plug className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{connection.name}</span>
                  <Badge variant="outline">
                    {connection.source === "user" ? t("providers.sourceUser") : t("providers.sourceDeploymentEnv")}
                  </Badge>
                  <Badge variant={connection.credentialPresent ? "secondary" : "destructive"}>
                    {connection.credentialPresent ? t("providers.credentialPresent") : t("providers.credentialMissing")}
                  </Badge>
                  {connection.source === "user" ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${t("common.edit")}: ${connection.name}`}
                        onClick={() => onEdit(connection)}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${t("common.delete")}: ${connection.name}`}
                        onClick={() => {
                          setDeleteError(null);
                          setConfirmingId(connection.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="truncate pl-6 text-xs text-muted-foreground">{subtitle}</div>
                {connection.source === "deployment-env" ? (
                  <div className="pl-6 text-xs text-muted-foreground">{t("providers.deploymentEnvReadonly")}</div>
                ) : null}
                {confirming ? (
                  <div role="alert" className="ml-6 space-y-2 rounded-md border border-destructive/50 p-3">
                    <div className="text-xs font-medium">{t("providers.deleteTitle")}</div>
                    <div className="text-xs text-muted-foreground">{t("providers.deleteBody")}</div>
                    {isDefault ? (
                      <div className="text-xs text-warning">{t("providers.deleteDefaultWarning")}</div>
                    ) : null}
                    {deleteError ? (
                      <div className="text-xs text-destructive">
                        {t("providers.deleteFailed")}: {deleteError}
                      </div>
                    ) : null}
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={deleting}
                        onClick={() => confirmDelete(connection)}
                      >
                        {t("common.confirm")}
                      </Button>
                      <Button variant="outline" size="sm" disabled={deleting} onClick={() => setConfirmingId(null)}>
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
