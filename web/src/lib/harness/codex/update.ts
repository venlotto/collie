// Codex 0.172.0 update prompt, captured at 52 columns. The pointer and footer license
// arrow navigation followed by Enter; digits are not a verified shortcut here.
import type { StyledLine } from "../../blocks";
import { pointerWalk } from "../menu-hints";
import type { PromptModel, PromptOption } from "../prompt-model";
import { lastNonBlankIndex, lineText, regionSignature, rstrip } from "./markers";

export function detectUpdateRegion(lines: StyledLine[]): { startLine: number; model: PromptModel } | null {
  const texts = lines.map((line) => rstrip(lineText(line)));
  const end = lastNonBlankIndex(texts);
  if (end < 0 || !/^\s*enter continue · esc skip$/.test(texts[end]!)) return null;
  const heading = texts.findIndex((text) => /^\s*Update available · \S+ → \S+$/.test(text));
  if (heading < 0) return null;
  const options: { label: string; pointed: boolean; row: number }[] = [];
  for (let row = heading + 1; row < end; row++) {
    const text = texts[row]!;
    const option = /^(› |  )([123])\. (.+)$/.exec(text);
    if (option) {
      if (Number(option[2]) !== options.length + 1) return null;
      options.push({ label: option[3]!, pointed: option[1] === "› ", row });
    } else if (options.length > 0 && text.trim() !== "") {
      if (!/^ {5}\S/.test(text)) return null;
      options[options.length - 1]!.label += text.trimStart();
    }
  }
  if (options.length !== 3 || options.filter((option) => option.pointed).length !== 1) return null;
  if (options[0]!.label !== "Update now (runs `npm install -g @openai/codex`)" ||
      options[1]!.label !== "Skip" || options[2]!.label !== "Skip until next version") return null;
  const pointed = options.findIndex((option) => option.pointed);
  return {
    startLine: options[0]!.row,
    model: {
      question: texts[heading]!.trim(),
      family: "select",
      signature: regionSignature(lines, heading, end + 1),
      coreSignature: texts[heading]!.trim(),
      options: options.map((option, index): PromptOption => {
        const result: PromptOption = { label: option.label, keys: pointerWalk(pointed, index) };
        if (option.pointed) result.keyLabel = "›";
        return result;
      }),
    },
  };
}
