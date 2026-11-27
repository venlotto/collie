import { useEffect, useState } from "react";
import { fetchAttachment } from "@/lib/api";
import { messageAttachments } from "@/lib/message-attachments";
import { useScope } from "@/lib/session";
import { Badge } from "./ui/badge";
import { Icon } from "./icons/icon";
import { JournalImage } from "./journal-image";

function SentAttachment({ id }: { id: string }) {
  const scope = useScope();
  const [meta, setMeta] = useState<{ name: string; image: boolean } | null>(null);
  const host = scope?.host;
  const session = scope?.session;
  useEffect(() => {
    const abort = new AbortController();
    setMeta(null);
    void fetchAttachment(id, { host, session }, abort.signal).then(value => {
      if (!abort.signal.aborted) setMeta(value);
      return undefined;
    }).catch(() => { /* Pruned or older bridge: keep a short minted label as a chip. */ });
    return () => abort.abort();
  }, [id, host, session]);
  const name = meta?.name ?? id.slice(id.lastIndexOf("-") + 1);
  return <span data-slot="sent-attachment" className="inline-block max-w-full align-middle">
    {meta?.image && <JournalImage ref_={`/api/attachments/${id}/image`} alt={name} scope={scope} />}
    <Badge variant="value" className="max-w-full whitespace-normal break-all">
      <Icon name={meta?.image ? "image" : "file-text"} aria-hidden="true" />{name}
    </Badge>
  </span>;
}

/** Presentation only: the terminal and the journal retain the exact line composeLine sent. */
export function UserMessageText({ text }: { text: string }) {
  return <>{messageAttachments(text).map((part, index) => "text" in part
    ? part.text : <SentAttachment key={`${index}:${part.id}`} id={part.id} />)}</>;
}
