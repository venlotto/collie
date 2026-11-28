import { useSyncExternalStore } from "react";
import { useLocale } from "@/hooks/use-locale";
import { loadDraft, subscribeDrafts } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import type { Scope } from "@/lib/scope";
import { DraftMark } from "./ui/draft-mark";

/** An unfocused chat keeps its unsent words visible; tapping only focuses its composer. */
export function BotDeskReply({ paneId, scope, placeholder, onReply }: {
  paneId: string; scope: Scope; placeholder: string; onReply: () => void;
}) {
  useLocale();
  const draft = useSyncExternalStore(subscribeDrafts, () => loadDraft(scope, paneId), () => null);
  return <button type="button" className="bot-desk-reply" data-draft={draft ? true : undefined}
    onClick={e => { e.stopPropagation(); onReply(); }}>
    {draft ? <>
      <span className="bot-desk-draft-label"><DraftMark scope={scope} paneId={paneId} />{t("pane.draftMark")}</span>
      <span className="bot-desk-draft-text">{draft}</span>
    </> : placeholder}
  </button>;
}
