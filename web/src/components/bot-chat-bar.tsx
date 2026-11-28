import { ChevronLeft, Ellipsis } from "lucide-react";
import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/hooks/use-locale";
import { t } from "@/lib/i18n";
import { localSendStatus, useSendIntents } from "@/lib/send-intent";
import { activityStatusOf } from "@/lib/activity-status";
import type { AgentView } from "@/lib/types";
import type { BotIdentity } from "./bot-identity";
import { BotActivityPill } from "./bot-activity-avatar";
import { BotViewControl } from "./bot-view-control";
import type { PaneView } from "@/lib/pane-view";
import { useDeskControls } from "./bot-desk-controls";
import { BotChatActionSheet, type BotChatActions } from "./bot-chat-actions";

export function BotChatBar({ bot, pane, unread, pinned, back, pin, toggleView, terminal, view, onViewChange, edit, actions, className = "" }: {
  edit?: () => void;
  pane: AgentView;
  bot: BotIdentity; unread: number; pinned: boolean; back: () => void; pin: () => void; toggleView?: () => void; terminal: boolean;
  view?: PaneView; onViewChange?: (view: PaneView) => void;
  actions?: BotChatActions;
  className?: string;
}) {
  useLocale();
  useSendIntents();
  const menu = useId();
  const [action, setAction] = useState<"move" | "trash" | null>(null);
  const manageable = actions && !actions.scope.host && (!!pane.terminalId || !!pane.agentRun) && !pane.trash;
  // On the desk (wide screens) the window controls stand where the phone keeps its Back arrow.
  const desk = useDeskControls();
  return <><header className={`bot-bar bot-chat-bar ${className}`}>
    {desk ?? <button className="bot-circle bot-back" onClick={back} aria-label="Volver a los chats"><ChevronLeft size={21} />{unread > 0 && <b>{unread}</b>}</button>}
    <BotActivityPill bot={bot} status={activityStatusOf(pane, localSendStatus(actions?.scope, pane.paneId, pane.lastSend))} onClick={edit} />
    <button className="bot-circle" aria-label="Opciones del chat" popoverTarget={menu}><Ellipsis size={21} /></button>
    <div id={menu} className="bot-popup" popover="auto">
      {edit && <button popoverTarget={menu} popoverTargetAction="hide" onClick={edit}>{t("bot.edit.title")}</button>}
      <button popoverTarget={menu} popoverTargetAction="hide" onClick={pin}>{pinned ? "Desfijar chat" : "Fijar chat"}</button>
      {view !== undefined && onViewChange ? <BotViewControl value={view} onChange={onViewChange} /> :
        toggleView && <button popoverTarget={menu} popoverTargetAction="hide" onClick={toggleView}>{terminal ? "Ver conversación" : "Ver terminal"}</button>}
      {manageable && <>
        <button popoverTarget={menu} popoverTargetAction="hide" disabled={!actions.writable} onClick={() => setAction("move")}>{t("bot.chatActions.move")}</button>
        <button className="bot-danger" popoverTarget={menu} popoverTargetAction="hide" disabled={!actions.writable} onClick={() => setAction("trash")}>{t("bot.chatActions.delete")}</button>
      </>}
    </div>
  </header>
    {action && manageable && createPortal(<BotChatActionSheet key={pane.agentRun?.rootId ?? pane.terminalId ?? pane.paneId} action={action} pane={pane} bot={bot} actions={actions} close={() => setAction(null)} />, document.body)}
  </>;
}
