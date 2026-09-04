import { useRef, useState, type KeyboardEvent } from "react";
import { SendHorizonal } from "lucide-react";
import type { SubmitMessageRequest } from "@sage/app-contracts";
import type { ApiClient } from "@/lib/api";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { InlineNotice } from "@/components/feedback";
import { errorMessage } from "./types";

/**
 * Message composer (spec §6.3, §6.9): Enter sends, Shift+Enter inserts a
 * newline, IME composition never triggers a send; while a submit is in flight
 * both the input and the button are disabled. Failure keeps the draft.
 */

const QUICK_PROMPTS: ReadonlyArray<MessageKey> = ["chat.quickSummarize", "chat.quickCreateTask", "chat.quickExploreRisk"];

export function Composer({
  client,
  sessionId,
  connectionId,
  onSent,
}: {
  client: ApiClient;
  sessionId: string;
  connectionId: string;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const composingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = draft.trim();
    if (text.length === 0 || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    const body: SubmitMessageRequest = { parts: [{ kind: "text", text }], provider: { connectionId } };
    client
      .request<unknown>(`/chat/sessions/${encodeURIComponent(sessionId)}/messages`, { method: "POST", body })
      .then(() => {
        setDraft("");
        onSent();
      })
      .catch((submitError: unknown) => setError(errorMessage(submitError, t("common.unknown"))))
      .finally(() => {
        sendingRef.current = false;
        setSending(false);
      });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (composingRef.current || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const onQuickPrompt = (key: MessageKey) => {
    setDraft(t(key));
    textareaRef.current?.focus();
  };

  return (
    <div className="space-y-2 border-t p-3">
      <div className="flex flex-wrap gap-2">
        {QUICK_PROMPTS.map((key) => (
          <Button key={key} type="button" variant="outline" size="sm" disabled={sending} onClick={() => onQuickPrompt(key)}>
            {t(key)}
          </Button>
        ))}
      </div>
      {error ? <InlineNotice variant="error">{error}</InlineNotice> : null}
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          disabled={sending}
          placeholder={t("chat.composerPlaceholder")}
          aria-label={t("chat.composerLabel")}
          className="min-h-[44px] flex-1"
        />
        <Button onClick={submit} disabled={sending || draft.trim().length === 0} aria-label={t("chat.send")}>
          <SendHorizonal aria-hidden="true" />
          {sending ? t("chat.sending") : t("chat.send")}
        </Button>
      </div>
    </div>
  );
}
