import { useRef, useState } from "react";
import type { ApiClient } from "@/lib/api";
import type { CreateAppResponse } from "@/types/packages";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  APP_DESCRIPTION_MAX_LENGTH,
  APP_ID_MAX_LENGTH,
  APP_ID_PATTERN,
  APP_NAME_MAX_LENGTH,
  buildCreateAppBody,
  validateCreateAppForm,
  type CreateAppFormError,
} from "./logic";

/**
 * Create App dialog (spec §9.2): validated id/name/description fields, error
 * surface inside the dialog, double-submit guard (§13.7). Radix Dialog
 * provides the modal semantics required by §14.4.
 */

const FIELD_ERROR_KEYS: Record<CreateAppFormError, MessageKey> = {
  appId: "packages.errorAppId",
  name: "packages.errorAppName",
  description: "packages.errorDescription",
};

export function CreateAppDialog({
  client,
  onClose,
  onCreated,
}: {
  client: ApiClient;
  onClose: () => void;
  onCreated: (appId: string) => void;
}) {
  const { t } = useI18n();
  const [appId, setAppId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState<CreateAppFormError[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    const form = { appId, name, description };
    const errors = validateCreateAppForm(form);
    setFieldErrors(errors);
    if (errors.length > 0) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    client
      .request<CreateAppResponse>("/apps", { method: "POST", body: buildCreateAppBody(form) })
      .then((created) => onCreated(created.appId))
      .catch((err: unknown) => setSaveError(errorMessage(err, t("common.unknown"))))
      .finally(() => {
        savingRef.current = false;
        setSaving(false);
      });
  };

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent aria-label={t("packages.createTitle")}>
        <DialogHeader>
          <DialogTitle>{t("packages.createTitle")}</DialogTitle>
          <DialogDescription>{t("packages.createDescription")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" aria-label={t("packages.createTitle")}>
          <div className="space-y-1.5">
            <Label htmlFor="create-app-id">{t("packages.fieldAppId")}</Label>
            <Input
              id="create-app-id"
              value={appId}
              maxLength={APP_ID_MAX_LENGTH}
              pattern={APP_ID_PATTERN.source}
              onChange={(event) => setAppId(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("packages.appIdHint")}</p>
            {fieldErrors.includes("appId") ? (
              <p role="alert" className="text-xs text-destructive">
                {t(FIELD_ERROR_KEYS.appId)}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-app-name">{t("packages.fieldAppName")}</Label>
            <Input
              id="create-app-name"
              value={name}
              maxLength={APP_NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)}
            />
            {fieldErrors.includes("name") ? (
              <p role="alert" className="text-xs text-destructive">
                {t(FIELD_ERROR_KEYS.name)}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-app-description">{t("packages.fieldDescription")}</Label>
            <Textarea
              id="create-app-description"
              value={description}
              maxLength={APP_DESCRIPTION_MAX_LENGTH}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
            />
            {fieldErrors.includes("description") ? (
              <p role="alert" className="text-xs text-destructive">
                {t(FIELD_ERROR_KEYS.description)}
              </p>
            ) : null}
          </div>

          {saveError ? (
            <InlineNotice variant="error">
              {t("packages.createFailed")}: {saveError}
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
