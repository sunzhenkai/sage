import { ShieldAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Banner } from "@/components/feedback";

/**
 * Configuration guidance for schedule authentication failures (spec §10.3):
 * the server needs `SAGE_SERVICE_TOKEN` or `SAGE_SERVICE_TOKEN_HASHES`
 * configured and the stack refreshed. Never fall back to stub trust headers
 * or fake a local success state.
 */
export function ScheduleAuthGuidance() {
  const { t } = useI18n();
  return (
    <Banner variant="error" title={t("schedules.authRequiredTitle")}>
      <span className="inline-flex items-start gap-1.5">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t("schedules.authRequiredBody")}</span>
      </span>
    </Banner>
  );
}
