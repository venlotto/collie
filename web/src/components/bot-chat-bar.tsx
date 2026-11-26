import { ChevronLeft, Ellipsis } from "lucide-react";
import { useId } from "react";
import { activityStatusOf } from "@/lib/activity-status";
import type { AgentView } from "@/lib/types";
import type { BotIdentity } from "./bot-identity";
import { BotActivityPill } from "./bot-activity-avatar";
import { BotViewControl } from "./bot-view-control";
import type { PaneView } from "@/lib/pane-view";
import { useDeskControls } from "./bot-desk-controls";

export function BotChatBar({ bot, pane, unread, pinned, back, pin, toggleView, terminal, view, onViewChange }: {
  pane: AgentView;
  bot: BotIdentity; unread: number; pinned: boolean; back: () => void; pin: () => void; toggleView?: () => void; terminal: boolean;
  view?: PaneView; onViewChange?: (view: PaneView) => void;
}) {
  const menu = useId();
  // On the desk (wide screens) the window controls stand where the phone keeps its Back arrow.
  const desk = useDeskControls();
  return <header className="bot-bar bot-chat-bar">
    {desk ?? <button className="bot-circle bot-back" onClick={back} aria-label="Volver a los chats"><ChevronLeft size={21} />{unread > 0 && <b>{unread}</b>}</button>}
    <BotActivityPill bot={bot} status={activityStatusOf(pane)} />
    <button className="bot-circle" aria-label="Opciones del chat" popoverTarget={menu}><Ellipsis size={21} /></button>
    <div id={menu} className="bot-popup" popover="auto">
      <button popoverTarget={menu} popoverTargetAction="hide" onClick={pin}>{pinned ? "Desfijar chat" : "Fijar chat"}</button>
      {view !== undefined && onViewChange ? <BotViewControl value={view} onChange={onViewChange} /> :
        toggleView && <button popoverTarget={menu} popoverTargetAction="hide" onClick={toggleView}>{terminal ? "Ver conversación" : "Ver terminal"}</button>}
    </div>
  </header>;
}
