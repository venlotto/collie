import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { ChatMessageListHandle } from "@/components/ui/chat/chat-message-list";
import { UserMessageText } from "@/components/user-message-text";
import { dropPending, usePending, HANDOVER_KEEP_MS, PENDING_KEEP_MS, type PendingLine } from "@/lib/durable-pending";
import { mirrorEchoCount } from "@/lib/mirror-echo";

function MirrorLine({ address, line, screen }: { address: string; line: PendingLine; screen: string }) {
  const echoed = line.state === "sent" && mirrorEchoCount(screen, line.text) > (line.mirrorCopies ?? 0);
  useEffect(() => {
    const forget = () => dropPending(address, [line.requestId]);
    if (echoed) {
      forget();
      return;
    }
    const keepMs = line.handover ? HANDOVER_KEEP_MS : PENDING_KEEP_MS;
    const timer = setTimeout(forget, Math.max(0, line.at + keepMs - Date.now()));
    return () => clearTimeout(timer);
  }, [address, line.at, line.requestId, line.handover, echoed]);

  return echoed ? null : <div data-slot="mirror-pending" className="bot-turn bot-turn-user whitespace-pre-wrap"><UserMessageText text={line.text} /></div>;
}

export function BotMirrorPending({ address, screen, listRef }: {
  address: string;
  screen: string;
  listRef: RefObject<ChatMessageListHandle | null>;
}) {
  const lines = usePending(address).filter(line => line.mirrorCopies !== undefined);
  const newest = lines.at(-1)?.requestId;
  const previous = useRef(newest);
  useLayoutEffect(() => {
    if (newest && newest !== previous.current) listRef.current?.scrollToBottom();
    previous.current = newest;
  }, [newest, listRef]);

  return lines.map(line => <MirrorLine key={line.requestId} address={address} line={line} screen={screen} />);
}
