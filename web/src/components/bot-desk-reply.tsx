import { useSyncExternalStore } from "react";
import { useLocale } from "@/hooks/use-locale";
import { loadDraft, loadDraftEntry, saveDraft, subscribeDrafts } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import type { Scope } from "@/lib/scope";
import { DraftMark } from "./ui/draft-mark";
import { ChatInput } from "./ui/chat/chat-input";

/** Every desk window has an editable field; focusing it brings in the full composer. */
export function BotDeskReply({ paneId, scope, placeholder, onReply }: {
  paneId: string; scope: Scope; placeholder: string; onReply: () => void;
}) {
  useLocale();
  const draft = useSyncExternalStore(subscribeDrafts, () => loadDraft(scope, paneId), () => null);
  return <div className="bot-desk-reply" data-draft={draft ? true : undefined}>
    {draft &&
      <span className="bot-desk-draft-label"><DraftMark scope={scope} paneId={paneId} />{t("pane.draftMark")}</span>
    }
    <ChatInput className="bot-desk-reply-input" rows={1} aria-label={placeholder} placeholder={placeholder}
      value={draft ?? ""} onFocus={onReply}
      onChange={e => {
        // Keep any text entered while navigation is pending, including existing attachment chips.
        const saved = loadDraftEntry(scope, paneId);
        saveDraft(scope, paneId, e.currentTarget.value, saved?.attachments, saved?.next);
      }} />
  </div>;
}
