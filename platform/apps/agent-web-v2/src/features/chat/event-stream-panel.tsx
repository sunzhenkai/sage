import { useState } from "react";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import type { TimelineEvent } from "@sage/app-contracts";
import { useI18n } from "@/lib/i18n";
import { formatShortTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/feedback";
import { copyTextToClipboard } from "./clipboard";

/**
 * Raw event stream panel (spec §6.8): expandable; each row shows sequence,
 * short time, payload kind and payload JSON. "Copy all" emits JSON Lines in
 * ascending sequence order and reports the copied count, or a clipboard
 * unavailable notice when both copy paths fail.
 */
export function EventStreamPanel({ events }: { events: readonly TimelineEvent[] }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [copyResult, setCopyResult] = useState<{ ok: boolean; count: number } | null>(null);

  const onCopyAll = () => {
    const lines = [...events]
      .sort((a, b) => a.sequence - b.sequence)
      .map((event) => JSON.stringify(event))
      .join("\n");
    copyTextToClipboard(lines)
      .then((ok) => setCopyResult({ ok, count: events.length }))
      .catch(() => setCopyResult({ ok: false, count: events.length }));
  };

  return (
    <section aria-label={t("chat.eventStreamLabel")} className="border-t">
      <div className="flex items-center gap-2 px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
        >
          {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          {open ? t("chat.eventStreamHide") : t("chat.eventStreamShow")}
        </Button>
        {open ? (
          <Button variant="outline" size="sm" onClick={onCopyAll}>
            <Copy aria-hidden="true" />
            {t("chat.copyAllEvents")}
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-2 px-4 pb-3">
          {copyResult ? (
            <InlineNotice variant={copyResult.ok ? "info" : "error"}>
              {copyResult.ok ? t("common.copied", { count: copyResult.count }) : t("common.clipboardUnavailable")}
            </InlineNotice>
          ) : null}
          <ul className="space-y-1 font-mono text-xs">
            {[...events]
              .sort((a, b) => a.sequence - b.sequence)
              .map((event) => (
                <li key={event.sequence} className="rounded border px-2 py-1">
                  <span className="text-muted-foreground">#{event.sequence}</span>{" "}
                  <time dateTime={event.occurredAt}>{formatShortTime(event.occurredAt, locale)}</time>{" "}
                  <span className="font-semibold">{event.payload.kind}</span>{" "}
                  <span className="break-all text-muted-foreground">{JSON.stringify(event.payload)}</span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
