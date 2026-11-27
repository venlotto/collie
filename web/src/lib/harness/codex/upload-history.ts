import { lineText, type Block, type StyledLine } from "@/lib/blocks";
import { messageAttachments } from "@/lib/message-attachments";

type RawBlock = Extract<Block, { kind: "raw" }>;
export type CodexUploadHistoryPart = RawBlock | { kind: "user-upload"; text: string };

/**
 * Lift only Codex's echoed upload turns out of a terminal-derived Messages view.
 *
 * The prompt marker alone is not evidence: Codex prints it on composers and numbered options too.
 * A candidate must contain a server-minted upload according to the one shared attachment parser.
 * Everything else, including the blank separator and the agent's reply, stays raw terminal output.
 */
export function liftCodexUploadEchoes(blocks: readonly RawBlock[]): readonly CodexUploadHistoryPart[] {
  let changed = false;
  const out: CodexUploadHistoryPart[] = [];
  for (const block of blocks) {
    let rawLines: StyledLine[] = [];
    const flush = () => {
      if (rawLines.length === 0) return;
      out.push({ kind: "raw", lines: rawLines });
      rawLines = [];
    };
    for (let at = 0; at < block.lines.length; ) {
      const first = lineText(block.lines[at]!);
      const marker = first.match(/^\s*› (.*)$/u);
      if (marker === null) {
        rawLines.push(block.lines[at]!);
        at++;
        continue;
      }
      let end = at + 1;
      while (end < block.lines.length) {
        const text = lineText(block.lines[end]!);
        if (text.trim() === "" || /^\s*› /u.test(text)) break;
        end++;
      }
      const body = [marker[1]!, ...block.lines.slice(at + 1, end).map(lineText)].join("\n");
      const parts = messageAttachments(body);
      if (!parts.some((part) => "id" in part)) {
        for (let i = at; i < end; i++) rawLines.push(block.lines[i]!);
        at = end;
        continue;
      }
      flush();
      // The terminal's rows are soft wraps, not newlines the person typed. The shared parser has
      // already identified and unwrapped the minted id; rejoin prose with spaces and give the shared
      // renderer an equivalent, canonical upload reference to parse once more.
      const text = parts.map((part) => "id" in part
        ? `/uploads/${part.id}`
        : part.text.replace(/\r?\n[ \t]*/gu, " ")).join("");
      out.push({ kind: "user-upload", text });
      changed = true;
      at = end;
    }
    flush();
  }
  return changed ? out : blocks;
}
