import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { ApiClient } from "@/lib/api";
import type { PackageReleaseResult } from "@/types/packages";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Banner, InlineNotice } from "@/components/feedback";
import { errorMessage } from "@/features/chat/types";
import { buildUploadFormData, validateUploadFile, type UploadValidationError } from "./logic";

/**
 * New-version upload (spec §9.4): behind a toggle, the archive is validated
 * client-side (selection, 8 MiB cap, extension) and posted as multipart
 * FormData with a single `file` field. Success refreshes the detail and
 * surfaces the new `packageVersion`.
 */

const UPLOAD_ERROR_KEYS: Record<UploadValidationError, MessageKey> = {
  missing: "packages.uploadErrorMissing",
  tooLarge: "packages.uploadErrorTooLarge",
  badExtension: "packages.uploadErrorExtension",
};

export function UploadRelease({
  client,
  appId,
  onUploaded,
}: {
  client: ApiClient;
  appId: string;
  onUploaded: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<UploadValidationError | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedVersion, setUploadedVersion] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (uploadingRef.current) return;
    const invalid = validateUploadFile(file);
    setValidationError(invalid);
    if (invalid || !file) return;
    uploadingRef.current = true;
    setUploading(true);
    setUploadError(null);
    setUploadedVersion(null);
    client
      .request<PackageReleaseResult>(`/apps/${encodeURIComponent(appId)}/releases`, {
        method: "POST",
        body: buildUploadFormData(file),
      })
      .then((result) => {
        setUploadedVersion(result.packageVersion);
        setFile(null);
        onUploaded();
      })
      .catch((err: unknown) => setUploadError(errorMessage(err, t("common.unknown"))))
      .finally(() => {
        uploadingRef.current = false;
        setUploading(false);
      });
  };

  return (
    <section aria-label={t("packages.uploadTitle")} className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("packages.uploadTitle")}</h2>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
            setValidationError(null);
            setUploadError(null);
          }}
        >
          <Upload aria-hidden="true" />
          {t("packages.uploadToggle")}
        </Button>
      </div>

      {uploadedVersion ? (
        <Banner variant="success" onDismiss={() => setUploadedVersion(null)}>
          {t("packages.uploadedNotice", { version: uploadedVersion })}
        </Banner>
      ) : null}

      {open ? (
        <form onSubmit={onSubmit} className="space-y-3" aria-label={t("packages.uploadTitle")}>
          <div className="space-y-1.5">
            <Label htmlFor="upload-archive-file">{t("packages.uploadFileLabel")}</Label>
            <input
              id="upload-archive-file"
              type="file"
              accept=".tar.gz,.tgz,.tar,.zip,.gz"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setValidationError(null);
              }}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm"
            />
            <p className="text-xs text-muted-foreground">{t("packages.uploadHint")}</p>
            {validationError ? (
              <p role="alert" className="text-xs text-destructive">
                {t(UPLOAD_ERROR_KEYS[validationError])}
              </p>
            ) : null}
          </div>

          {uploadError ? (
            <InlineNotice variant="error">
              {t("packages.uploadFailed")}: {uploadError}
            </InlineNotice>
          ) : null}

          <Button type="submit" disabled={uploading}>
            {uploading ? t("packages.uploading") : t("packages.uploadSubmit")}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
