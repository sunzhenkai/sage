import { ApiError } from "@/lib/api";
import type { AppSummaryApi, ManifestSummary, PackageSummaryView } from "@/types/packages";

/**
 * Pure Packages-view logic (spec §9) kept component-free for unit tests:
 * list mapping, create-form validation, archive upload validation, sample
 * import error classification, and run request building.
 */

/** §9.2 App ID constraint. */
export const APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
export const APP_ID_MAX_LENGTH = 128;
export const APP_NAME_MAX_LENGTH = 128;
export const APP_DESCRIPTION_MAX_LENGTH = 2048;

/** §9.4 archive limits. */
export const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
export const ARCHIVE_FILE_PATTERN = /\.(?:tar\.gz|tgz|tar|zip|gz)$/i;

/** §9.1 response → UI summary mapping. */
export function toPackageSummary(app: AppSummaryApi): PackageSummaryView {
  return {
    packageId: app.appId,
    name: app.name ?? app.appId,
    description: app.description,
    releaseCount: app.releaseCount,
    latestVersion: app.latestVersion ?? null,
    latestContentDigest: app.latestContentDigest ?? "",
    updatedAt: app.updatedAt ?? app.createdAt,
  };
}

export interface CreateAppFormState {
  appId: string;
  name: string;
  description: string;
}

export type CreateAppFormError = "appId" | "name" | "description";

/** §9.2 create form validation: trim-then-check for id/name, length caps. */
export function validateCreateAppForm(form: CreateAppFormState): CreateAppFormError[] {
  const errors: CreateAppFormError[] = [];
  const appId = form.appId.trim();
  if (appId.length === 0 || appId.length > APP_ID_MAX_LENGTH || !APP_ID_PATTERN.test(appId)) {
    errors.push("appId");
  }
  const name = form.name.trim();
  if (name.length === 0 || name.length > APP_NAME_MAX_LENGTH) {
    errors.push("name");
  }
  if (form.description.length > APP_DESCRIPTION_MAX_LENGTH) {
    errors.push("description");
  }
  return errors;
}

/** §9.2 request body: trimmed, description omitted when empty. */
export function buildCreateAppBody(form: CreateAppFormState): { appId: string; name: string; description?: string } {
  const description = form.description.trim();
  return {
    appId: form.appId.trim(),
    name: form.name.trim(),
    ...(description.length > 0 ? { description } : {}),
  };
}

export type UploadValidationError = "missing" | "tooLarge" | "badExtension";

/** §9.4 client-side archive validation (name + size only, File-agnostic). */
export function validateUploadFile(file: { name: string; size: number } | null | undefined): UploadValidationError | null {
  if (!file) return "missing";
  if (file.size > MAX_ARCHIVE_BYTES) return "tooLarge";
  if (!ARCHIVE_FILE_PATTERN.test(file.name)) return "badExtension";
  return null;
}

/** §9.4 multipart body: a single `file` field. */
export function buildUploadFormData(file: File): FormData {
  const formData = new FormData();
  formData.append("file", file, file.name);
  return formData;
}

/** §9.5: 409 / APP_ALREADY_EXISTS during sample import is not a failure. */
export function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 409 || error.code === "APP_ALREADY_EXISTS");
}

/** §9.7: provider dependency failure gets a dedicated explanation. */
export function isProviderDependencyMissing(error: unknown): boolean {
  return error instanceof ApiError && error.code === "PROVIDER_DEPENDENCY_MISSING";
}

export interface RunRequestBody {
  task?: string;
  params?: Record<string, string | number>;
}

export type RunRequestBuildError = { kind: "nonFiniteNumber"; name: string };

/**
 * §9.7 run request building:
 * - blank (trimmed-empty) fields are not submitted — the server applies the
 *   declared defaults;
 * - `number` inputs convert to JS numbers; a non-finite result is a param
 *   error surfaced to the user;
 * - a task is only sent when the manifest declares more than one task
 *   (defaulting to the first).
 */
export function buildRunRequest(
  manifest: ManifestSummary | undefined,
  values: Record<string, string>,
  selectedTask: string | undefined,
): { ok: true; body: RunRequestBody } | { ok: false; error: RunRequestBuildError } {
  const params: Record<string, string | number> = {};
  for (const input of manifest?.inputs ?? []) {
    const raw = (values[input.name] ?? "").trim();
    if (raw.length === 0) continue;
    if (input.type === "number") {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return { ok: false, error: { kind: "nonFiniteNumber", name: input.name } };
      }
      params[input.name] = parsed;
    } else {
      params[input.name] = raw;
    }
  }
  const tasks = manifest?.tasks ?? [];
  const body: RunRequestBody = {};
  if (tasks.length > 1) {
    const task = selectedTask && selectedTask.length > 0 ? selectedTask : tasks[0]?.name;
    if (task !== undefined) body.task = task;
  }
  if (Object.keys(params).length > 0) body.params = params;
  return { ok: true, body };
}

/** Whether an input renders as an enum dropdown (spec §9.7 rule 3). */
export function isEnumInput(input: { type: string; enum?: readonly (string | number)[] | undefined }): boolean {
  return input.type === "enum" || (input.enum !== undefined && input.enum.length > 0);
}
