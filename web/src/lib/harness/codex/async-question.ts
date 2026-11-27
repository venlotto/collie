// Codex's ASYNC question (`request_user_input_async`, Codex 0.172.0, captured 2026-11-27 on a disposable
// Herdr pane at 52 columns; fixtures/panes/codex--v0172-async-*, ASYNC_QUESTION_NOTES.md). Two screens:
//
// 1. THE REMINDER. The turn keeps running and the queue over the live input box says a question waits:
//
//      • Queued follow-up inputs
//        ? 1 question
//          shift+← to answer
//                                 ⚠ weekly limit: 20% left
//
//      › Ask Codex to do anything
//
//    The box keeps the keyboard, so the card is a notice above a live box (`MenuModel.liveBox`, ADR
//    0109) and owns none of it: the Surface stays `modal: none` and a message can still be sent. Its one
//    button is the key the row prints, `shift+←` (Herdr's `shift+Left`, probed live), which opens the
//    question. With a draft in the box the key would move the caret, so the button waits for an empty box.
//
// 2. THE QUESTION, opened by that key. It replaces the box until it is answered:
//
//        Tabs or spaces?
//
//        › 1. Tabs
//          2. Spaces
//          3. Other
//
//        enter submit   ^] skip   shift+→ main prompt
//
//    A digit answers and submits (probed: `2` answered "Spaces", `1` answered "Tabs", and the pane went
//    back to `working`). `Other` opens a text field nobody has probed, so it is left out of the card and
//    stays one tap away in the terminal. The card is a `prompt-select` and lifts as the Surface's ask, so
//    the bridge answers it by id like any other.
//
// Anything off these shapes stays raw. Pure; no pane access.

import type { StyledLine } from "../../blocks";
import { queuedQuestion } from "../../pending-question";
import type { MenuModel } from "../menu-model";
import type { PromptModel, PromptOption } from "../prompt-model";
import { extractInputDraft, locateComposer } from "./chrome";
import { lastNonBlankIndex, lineText, regionSignature, rstrip, skipBlanksUp } from "./markers";

/** The key the reminder prints, in Herdr's grammar. */
export const OPEN_QUESTION_KEYS = ["shift+Left"] as const;

/** A reminder over the live box: its rows, `startLine` to `endLine` inclusive, and its card. */
export interface QueuedQuestionRegion {
  startLine: number;
  endLine: number;
  model: MenuModel;
}

/** An opened question at the tail: where it starts, and its card. */
export interface AsyncPanelRegion {
  startLine: number;
  model: PromptModel;
}

const QUEUE_HEAD = /^• Queued follow-up inputs$/;
/** A right-aligned notice Codex paints between the queue and the box (`⚠ weekly limit: 20% left`). */
const RIGHT_NOTICE = /^ {8,}⚠ \S/;
/** The question as the transcript keeps it: `? Tabs or spaces?` at column 0. */
const HISTORY_QUESTION = /^\? (\S.*)$/;
const HISTORY_OPTION = /^ {2}• (\S.*)$/;
/** How far up the transcript the question's history cell is looked for. */
const HISTORY_REACH = 30;

/**
 * The text of the newest question cell in the transcript above `from`, or null: `? Tabs or spaces?`
 * followed by its `• option` rows. Display only: the card's identity is the reminder's own rows.
 */
function historyQuestion(texts: readonly string[], from: number): string | null {
  for (let i = from - 1; i >= 0 && from - i <= HISTORY_REACH; i--) {
    const head = HISTORY_QUESTION.exec(texts[i]!);
    if (head === null) continue;
    const next = skipBlanksDown(texts, i + 1);
    return next >= 0 && HISTORY_OPTION.test(texts[next]!) ? head[1]!.trim() : null;
  }
  return null;
}

function skipBlanksDown(texts: readonly string[], i: number): number {
  let at = i;
  while (at < texts.length && texts[at]!.trim() === "") at++;
  return at < texts.length && at - i <= 1 ? at : -1;
}

/** The reminder over Codex's live input box, or null. */
export function detectQueuedQuestion(lines: StyledLine[]): QueuedQuestionRegion | null {
  const box = locateComposer(lines);
  if (box === null) return null;
  const texts = lines.map((l) => rstrip(lineText(l)));
  const found = queuedQuestion(texts.slice(0, box.top));
  if (found === null) return null;
  // Between the reminder and the box: blank rows and Codex's right-aligned notices, nothing else. A row
  // of output there means the reminder is not the live queue's.
  for (let i = found.last + 1; i < box.top; i++) {
    const text = texts[i]!;
    if (text.trim() !== "" && !RIGHT_NOTICE.test(text)) return null;
  }
  const start = found.first > 0 && QUEUE_HEAD.test(texts[found.first - 1]!) ? found.first - 1 : found.first;
  const question = found.count === 1 ? historyQuestion(texts, start) : null;
  return {
    startLine: start,
    endLine: found.last,
    model: {
      // The question the transcript printed for it, or the reminder's own words.
      title: question ?? texts[found.first]!.trim().replace(/^\?\s*/, ""),
      actions: [{ label: "Answer", keys: [...OPEN_QUESTION_KEYS] }],
      nav: { upDown: false },
      // From the key row down to the prompt row: the box must read as it did when the card was drawn,
      // so a draft typed since refuses the tap. The count row above it may print an age that ticks, so it
      // is left out of the binding.
      signature: regionSignature(lines, found.last, box.promptRow + 1),
      liveBox: { draft: extractInputDraft(lines) !== null, queued: found.count },
    },
  };
}

const PANEL_FOOTER = /^\s*enter submit\s+\^\] skip\s+shift\+→ main prompt$/;
// The pointed row leads with `  › `, the others with four spaces.
const PANEL_OPTION = /^(?:\s{2}› |\s{4})([1-9])\. (\S.*)$/;
/** An option label that wrapped onto the next row, indented past the number. */
const PANEL_CONTINUATION = /^ {7,}\S/;
const OTHER = "Other";
/** How many rows up from the question the queue's head may sit (blank rows between). */
const HEAD_REACH = 4;

/** The question Codex opened from its queue, at the tail, or null. */
export function detectAsyncPanel(lines: StyledLine[]): AsyncPanelRegion | null {
  const texts = lines.map((l) => rstrip(lineText(l)));
  const fi = lastNonBlankIndex(texts);
  if (fi < 3 || !PANEL_FOOTER.test(texts[fi]!)) return null;
  const bottom = skipBlanksUp(texts, fi - 1);
  if (bottom < 0) return null;

  // The option run, read upwards: a row that is not an option is a wrapped label of the option above it.
  const rows: { digit: string; label: string }[] = [];
  let pending: string[] = [];
  let i = bottom;
  for (; i >= 0; i--) {
    const text = texts[i]!;
    const option = PANEL_OPTION.exec(text);
    if (option !== null) {
      rows.unshift({ digit: option[1]!, label: [option[2]!.trim(), ...pending].join(" ") });
      pending = [];
      continue;
    }
    if (PANEL_CONTINUATION.test(text) && pending.length < 3) {
      pending.unshift(text.trim());
      continue;
    }
    break;
  }
  if (pending.length > 0 || rows.length < 2) return null;
  for (let k = 0; k < rows.length; k++) if (rows[k]!.digit !== String(k + 1)) return null;

  // The question: indented rows straight above the options, across one blank row.
  const questionEnd = skipBlanksUp(texts, i);
  if (questionEnd < 0 || questionEnd === i) return null;
  let top = questionEnd;
  while (top > 0 && /^ {2}\S/.test(texts[top - 1]!) && !PANEL_OPTION.test(texts[top - 1]!)) top--;
  if (!/^ {2}\S/.test(texts[top]!)) return null;
  // The queue's head stands above the question: what proves this is the queue's question and not a
  // look-alike list printed by something else.
  let head = top - 1;
  while (head >= 0 && top - head <= HEAD_REACH && texts[head]!.trim() === "") head--;
  if (head < 0 || !QUEUE_HEAD.test(texts[head]!)) return null;

  const question = texts.slice(top, questionEnd + 1).map((row) => row.trim()).join(" ");
  const signature = regionSignature(lines, top, fi + 1);
  if (signature === "") return null;
  // `Other` opens a text field: no recipe for it, so no button. It is always the last row.
  const answers = rows.at(-1)!.label === OTHER ? rows.slice(0, -1) : rows;
  if (answers.length < 1) return null;
  const options: PromptOption[] = answers.map((row) => ({ label: row.label, keys: [row.digit] }));
  return {
    startLine: top,
    model: {
      question,
      options,
      // `select` pins the caption; the digit alone submits (probed), and the per-option keys say so.
      family: "select",
      coreSignature: question,
      signature,
    },
  };
}
