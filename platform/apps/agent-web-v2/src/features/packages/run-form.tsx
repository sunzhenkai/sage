import { useRef, useState } from "react";
import { Play } from "lucide-react";
import type { ApiClient } from "@/lib/api";
import type { ManifestSummary, PackageRunResult } from "@/types/packages";
import { useI18n } from "@/lib/i18n";
import { workspaceHref } from "@/app/router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Banner, InlineNotice } from "@/components/feedback";
import { errorMessage } from "@/features/chat/types";
import { buildRunRequest, isEnumInput, isProviderDependencyMissing } from "./logic";

/**
 * Package run launch (spec §9.7): requires at least one release and always
 * uses the first release's `releaseId`. The form is generated from the
 * manifest: a task select when more than one task is declared (defaulting to
 * the first), enum inputs as dropdowns with a "use default" empty option,
 * number inputs converted to JS numbers (non-finite values are param
 * errors), and blank fields omitted so the server applies declared defaults.
 * A re-entrancy guard blocks double starts (§13.7).
 */
export function RunForm({
  client,
  appId,
  manifest,
  releaseId,
  session,
}: {
  client: ApiClient;
  appId: string;
  manifest: ManifestSummary | undefined;
  releaseId: string | undefined;
  session?: string | undefined;
}) {
  const { t } = useI18n();
  const tasks = manifest?.tasks ?? [];
  const inputs = manifest?.inputs ?? [];
  const [selectedTask, setSelectedTask] = useState<string>(tasks[0]?.name ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [paramError, setParamError] = useState<string | null>(null);
  const [startError, setStartError] = useState<{ providerMissing: boolean; message: string } | null>(null);
  const [startedTaskId, setStartedTaskId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (startingRef.current || !releaseId) return;
    const built = buildRunRequest(manifest, values, selectedTask);
    if (!built.ok) {
      setParamError(built.error.name);
      return;
    }
    setParamError(null);
    startingRef.current = true;
    setStarting(true);
    setStartError(null);
    setStartedTaskId(null);
    client
      .request<PackageRunResult>(`/releases/${encodeURIComponent(releaseId)}/runs`, {
        method: "POST",
        body: built.body,
      })
      .then((result) => setStartedTaskId(result.taskId))
      .catch((err: unknown) =>
        setStartError({ providerMissing: isProviderDependencyMissing(err), message: errorMessage(err, t("common.unknown")) }),
      )
      .finally(() => {
        startingRef.current = false;
        setStarting(false);
      });
  };

  return (
    <section aria-label={t("packages.runTitle")} className="space-y-3 rounded-lg border p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Play className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {t("packages.runTitle")}
      </h2>

      {!releaseId ? (
        <p className="text-sm text-muted-foreground">{t("packages.runNoRelease")}</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3" aria-label={t("packages.runTitle")}>
          {tasks.length > 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="run-task-select">{t("packages.runTaskLabel")}</Label>
              <select
                id="run-task-select"
                aria-label={t("packages.runTaskLabel")}
                value={selectedTask}
                onChange={(event) => setSelectedTask(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {tasks.map((task) => (
                  <option key={task.name} value={task.name}>
                    {task.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {inputs.map((input) => {
            const fieldId = `run-param-${appId}-${input.name}`;
            const label = (
              <Label htmlFor={fieldId} className="flex items-center gap-2">
                {input.name}
                {input.required ? <Badge variant="warning">{t("packages.inputRequired")}</Badge> : null}
              </Label>
            );
            if (isEnumInput(input)) {
              return (
                <div key={input.name} className="space-y-1.5">
                  {label}
                  <select
                    id={fieldId}
                    aria-label={input.name}
                    value={values[input.name] ?? ""}
                    onChange={(event) => setValues((state) => ({ ...state, [input.name]: event.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">{t("packages.runUseDefault")}</option>
                    {(input.enum ?? []).map((option) => (
                      <option key={String(option)} value={String(option)}>
                        {String(option)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }
            return (
              <div key={input.name} className="space-y-1.5">
                {label}
                <Input
                  id={fieldId}
                  inputMode={input.type === "number" ? "decimal" : undefined}
                  placeholder={input.default !== undefined ? String(input.default) : undefined}
                  value={values[input.name] ?? ""}
                  onChange={(event) => setValues((state) => ({ ...state, [input.name]: event.target.value }))}
                />
              </div>
            );
          })}

          {paramError ? (
            <InlineNotice variant="error">{t("packages.runParamInvalid", { name: paramError })}</InlineNotice>
          ) : null}

          {startError ? (
            <InlineNotice variant="error">
              {startError.providerMissing ? (
                <>
                  {t("packages.runProviderMissing")}
                  <br />
                </>
              ) : (
                <>{t("packages.runFailed")}: </>
              )}
              {startError.message}
            </InlineNotice>
          ) : null}

          {startedTaskId ? (
            <Banner variant="success">
              {t("packages.runStarted")}{" "}
              <a
                href={workspaceHref({ view: "tasks", task: startedTaskId, session })}
                className="font-medium underline underline-offset-4"
              >
                {t("packages.runViewTask")}
              </a>
            </Banner>
          ) : null}

          <Button type="submit" disabled={starting}>
            {starting ? t("packages.runStarting") : t("packages.runSubmit")}
          </Button>
        </form>
      )}
    </section>
  );
}
