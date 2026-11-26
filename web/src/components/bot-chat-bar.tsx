import { ChevronLeft, Ellipsis } from "lucide-react";
import { useId } from "react";
import { useLocale } from "@/hooks/use-locale";
import { activityStatusOf } from "@/lib/activity-status";
import type { AgentView } from "@/lib/types";
import type { BotIdentity } from "./bot-identity";
import { BotActivityAvatar, activityLabel } from "./bot-activity";

export function BotChatBar({ bot, pane, unread, pinned, back, pin, toggleView, terminal }: {
  pane: AgentView;
  bot: BotIdentity; unread: number; pinned: boolean; back: () => void; pin: () => void; toggleView?: () => void; terminal: boolean;
}) {
  useLocale();
  const menu = useId();
  const status = activityStatusOf(pane);
  const label = activityLabel(status);
  return <header className="bot-bar bot-chat-bar">
    <button className="bot-circle bot-back" onClick={back} aria-label="Volver a los chats"><ChevronLeft size={21} />{unread > 0 && <b>{unread}</b>}</button>
    <div className="bot-pill" title={label || undefined}>
      <BotActivityAvatar bot={bot} status={status} /><strong>{bot.name}</strong>
      <span className="sr-only" role="status">{label}</span>
    </div>
    <button className="bot-circle" aria-label="Opciones del chat" popoverTarget={menu}><Ellipsis size={21} /></button>
    <div id={menu} className="bot-popup" popover="auto">
      <button popoverTarget={menu} popoverTargetAction="hide" onClick={pin}>{pinned ? "Desfijar chat" : "Fijar chat"}</button>
      {toggleView && <button popoverTarget={menu} popoverTargetAction="hide" onClick={toggleView}>{terminal ? "Ver conversación" : "Ver terminal"}</button>}
    </div>
  </header>;
}
