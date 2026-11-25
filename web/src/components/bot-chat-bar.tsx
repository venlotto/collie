import { ChevronLeft, Ellipsis } from "lucide-react";
import { useId } from "react";
import { BlobAvatar, type BotIdentity } from "./bot-identity";

export function BotChatBar({ bot, unread, pinned, back, pin, toggleView, terminal }: {
  bot: BotIdentity; unread: number; pinned: boolean; back: () => void; pin: () => void; toggleView?: () => void; terminal: boolean;
}) {
  const menu = useId();
  return <header className="bot-bar bot-chat-bar">
    <button className="bot-circle bot-back" onClick={back} aria-label="Volver a los chats"><ChevronLeft size={21} />{unread > 0 && <b>{unread}</b>}</button>
    <div className="bot-pill"><BlobAvatar {...bot} /><strong>{bot.name}</strong></div>
    <button className="bot-circle" aria-label="Opciones del chat" popoverTarget={menu}><Ellipsis size={21} /></button>
    <div id={menu} className="bot-popup" popover="auto">
      <button popoverTarget={menu} popoverTargetAction="hide" onClick={pin}>{pinned ? "Desfijar chat" : "Fijar chat"}</button>
      {toggleView && <button popoverTarget={menu} popoverTargetAction="hide" onClick={toggleView}>{terminal ? "Ver conversación" : "Ver terminal"}</button>}
    </div>
  </header>;
}
