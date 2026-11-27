import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/hooks/use-locale";
import { actOnBot, fetchSnapshot } from "@/lib/api";
import { describeThrownError } from "@/lib/api-error-message";
import { closeWindow, updateDesk } from "@/lib/bot-desk";
import { useBotFeatured } from "@/lib/bot-featured";
import { forgetBot, saveBot, type BotIdentity } from "@/lib/bot-identity";
import { activeBotWorkspaces } from "@/lib/bot-workspaces";
import { paneRowKey } from "@/lib/hosts";
import { t } from "@/lib/i18n";
import type { Scope } from "@/lib/scope";
import type { AgentView, WorkspaceView } from "@/lib/types";
import { BotActionSheet } from "./bot-selection";

export interface BotChatActions {
  scope: Scope;
  writable: boolean;
  onChanged: () => void;
  onDone?: () => void;
}

/** The sheet lives outside the popover: hiding the menu must not hide its dialog. */
export function BotChatActionSheet({ action, pane, bot, actions, close }: {
  action: "move" | "trash"; pane: AgentView; bot: BotIdentity; actions: BotChatActions; close: () => void;
}) {
  useLocale();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const { clearFeatured } = useBotFeatured();
  const [workspaces, setWorkspaces] = useState<WorkspaceView[] | null>(null);
  const { host, session } = actions.scope;
  useEffect(() => {
    if (action !== "move") return;
    const controller = new AbortController();
    async function read() {
      try {
        const snapshot = await fetchSnapshot({ host, session }, controller.signal);
        if (!controller.signal.aborted) setWorkspaces(activeBotWorkspaces(snapshot.workspaces, [...snapshot.agents, ...snapshot.shellPanes], { host, session }, snapshot.servers, snapshot.sessions));
      } catch (err) {
        if (!controller.signal.aborted) { setError(describeThrownError(err)); setWorkspaces([]); }
      }
    }
    void read();
    return () => controller.abort();
  }, [action, host, session]);
  const destinations = workspaces?.filter(w => w.workspaceId !== "agent-runs" && w.workspaceId !== pane.workspaceId) ?? [];
  const allowed = actions.writable && !actions.scope.host && !!pane.terminalId && !pane.trash;
  async function apply(workspaceId?: string) {
    if (!allowed || locked.current || leaving) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await actOnBot(action, pane, actions.scope, workspaceId);
      if (!result.ok) throw new Error(t("bot.chatActions.failed"));
    } catch (err) {
      setError(describeThrownError(err));
      locked.current = false;
      setBusy(false);
      return;
    }
    // Preserve the portrait across pane relocation; only deletion closes the chat.
    saveBot(actions.scope, pane.terminalId!, bot);
    if (pane.paneId !== pane.terminalId) forgetBot(actions.scope, pane.paneId);
    clearFeatured(pane);
    if (action === "trash") {
      updateDesk(d => closeWindow(d, paneRowKey(pane)));
      actions.onDone?.();
    }
    setLeaving(true);
    setBusy(false);
    actions.onChanged();
  }
  const dismiss = () => { if (!locked.current) setLeaving(true); };
  return <BotActionSheet title={t(action === "trash" ? "bot.chatActions.delete" : "bot.chatActions.move")}
    busy={busy} leaving={leaving} dismiss={dismiss} close={close}>
    {action === "trash" ? <>
      <p>{t("bot.chatActions.confirm", { name: bot.name })}</p>
      <button className="bot-choice bot-danger" disabled={!allowed || busy || leaving} onClick={() => void apply()}>{t("bot.chatActions.delete")}</button>
    </> : workspaces === null ? <p role="status">{t("conversations.loading")}</p> : destinations.length ? destinations.map(w => <button key={w.workspaceId} className="bot-choice"
      disabled={!allowed || busy || leaving} onClick={() => void apply(w.workspaceId)}>{w.label || w.workspaceId}</button>) : <p>{t("bot.chatActions.empty")}</p>}
    <button className="bot-choice" disabled={busy || leaving} onClick={dismiss}>{t("bot.chatActions.cancel")}</button>
    {error && <p role="alert">{error}</p>}
  </BotActionSheet>;
}
