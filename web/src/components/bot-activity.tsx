import { Disclosure, ItemView, standsAlone } from "@/components/chat-cards";
import { MarkdownText } from "@/components/markdown-text";
import type { ChatItem } from "@/lib/chat-items";
import { useLocale } from "@/hooks/use-locale";
import { t, tn } from "@/lib/i18n";

export function botRowKind(item: ChatItem) {
  if (item.kind === "reply" && item.intermediate) return "activity";
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
export function groupBotTurns(turns: { user: boolean; items: ChatItem[] }[], working = false) {
  // A user message bounds a response. Only its last reply, after the last work step,
  // stands outside the fold; while the newest response works, its prose is progress too.
  const responses: ChatItem[][] = [];
  for (const turn of turns) {
    if (turn.user || responses.length === 0) responses.push([]);
    responses[responses.length - 1]!.push(...turn.items);
  }
  const blocks: ChatItem[][] = [];
  let latestActivity: ChatItem[] | undefined;
  for (const [index, response] of responses.entries()) {
    latestActivity = undefined;
    const lastWork = response.findLastIndex(item => botRowKind(item) === "activity");
    const lastReply = response.findLastIndex(item => item.kind === "reply");
    const inProgress = working && index === responses.length - 1;
    for (const [position, original] of response.entries()) {
      const item: ChatItem = original.kind === "reply" && (inProgress || position !== lastReply || position < lastWork)
        ? { ...original, intermediate: true }
        : original;
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

export function BotActivity({ items }: { items: ChatItem[] }) {
  useLocale();
  return (
    <Disclosure icon="disclosure" label={tn("chat.run.steps", items.length)} collapseLabel={t("composer.collapse")}>
      {() => <div className="bot-activity-detail">{items.map(item =>
        item.kind === "thinking"
          ? <MarkdownText key={item.id} text={item.text} className="italic text-muted-foreground" />
          : <ItemView key={item.id} item={item} />,
      )}</div>}
    </Disclosure>
  );
}
