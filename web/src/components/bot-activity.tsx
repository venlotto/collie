import { Disclosure, ItemView, standsAlone } from "@/components/chat-cards";
import { MarkdownText } from "@/components/markdown-text";
import type { ChatItem } from "@/lib/chat-items";
import { t, tn } from "@/lib/i18n";

export function botRowKind(item: ChatItem) {
  if (item.kind === "thinking" || item.kind === "compacted" || item.kind === "notice") return "activity";
  if (item.kind !== "tool") return item.kind;
  if (item.status === "failed" || item.status === "denied" ||
      (item.tool.kind === "execute" && item.tool.exitCode !== undefined && item.tool.exitCode !== 0)) return "error";
  if (item.tool.kind === "question") return "question";
  // Keep returned pictures and messages to another bot in the conversation.
  if (item.image || (item.tool.kind !== "task" && standsAlone(item))) return "tool";
  return "activity";
}

/** A question or a report can arrive between two steps of the same user turn.
 * Keep its card in order and append later steps to that turn's original disclosure. */
export function groupBotTurns(turns: { user: boolean; items: ChatItem[] }[]) {
  const blocks: ChatItem[][] = [];
  let latestActivity: ChatItem[] | undefined;
  for (const turn of turns) {
    // The person can send a picture without text. The entry still starts a new turn.
    if (turn.user) latestActivity = undefined;
    for (const item of turn.items) {
      if (botRowKind(item) !== "activity") {
        blocks.push([item]);
        continue;
      }
      if (!latestActivity) {
        latestActivity = [];
        blocks.push(latestActivity);
      }
      latestActivity.push(item);
    }
  }
  return { blocks, latestActivity };
}

export function BotActivity({ items, working }: { items: ChatItem[]; working: boolean }) {
  return (
    <Disclosure icon="disclosure" label={working ? t("chat.stream.working") : tn("chat.run.steps", items.length)}>
      {() => <div className="bot-activity-detail">{items.map(item =>
        item.kind === "thinking"
          ? <MarkdownText key={item.id} text={item.text} className="italic text-muted-foreground" />
          : <ItemView key={item.id} item={item} />,
      )}</div>}
    </Disclosure>
  );
}
