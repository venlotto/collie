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
//    back to `working`). The card is a `prompt-select` and lifts as the Surface's ask, so the bridge
//    answers it by id like any other.
//
// 3. SEVERAL QUESTIONS (`? 2 questions`, one call that asked two; probed on a scratch tmux server at 52
//    columns). The reminder is the same; the transcript holds one `? <question>` cell per question, and
//    the card names them all. The key opens them one at a time: the first carries `1 of 2` over it and a
//    second footer row, `shift+← next question`. A digit answers that one alone (`↪ Re: Color? / Red`)
//    and the next opens in the one-question shape, so the card follows on the next poll.
//
// 4. `OTHER`, the last row when the question allows one. Its digit only moves the pointer there (the
//    label turns faint: the field is empty); what is typed then stands in the label's place, digits
//    included, and Enter sends it as the answer (`↪ Re: Pet? / Fish 42, maybe 3`). The card models the
//    row as a text field (`PromptFeedback`, purpose `other`), never as a button, and types into it only
//    while it is empty, by the same digit → focus → type → Enter recipe as Claude's plan field
//    (lib/prompt-action.ts). A pointed last row whose label is not the faint placeholder is the field
//    when the transcript's cell for the question proves it (one answer fewer than rows). With the cell
//    scrolled away (a 23-row pane) it could be a third answer: the field is lifted marked `unproven`,
//    every answer locks, and only the recipe's Enter over the words it typed at that row may follow.
//
// Anything off these shapes stays raw. Pure; no pane access.

import type { StyledLine } from "../../blocks";
import { queuedQuestion } from "../../pending-question";
import type { MenuModel } from "../menu-model";
import type { PromptFeedback, PromptModel, PromptOption } from "../prompt-model";
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
/** How far up the transcript the question's history cells are looked for. */
const HISTORY_REACH = 40;

/** One question cell of the transcript: `? Tabs or spaces?` and its `• option` rows. */
interface HistoryCell {
  question: string;
  options: string[];
}

/**
 * The question cells in the transcript above `from`, newest first, up to `most` of them: each a
 * `? <question>` row followed by its `• option` rows. A `?` row with no option under it ends the walk
 * (it is no cell of this shape). Display and proof only: the card's identity is the screen's own rows.
 */
function historyCells(texts: readonly string[], from: number, most: number): HistoryCell[] {
  const cells: HistoryCell[] = [];
  for (let i = from - 1; i >= 0 && from - i <= HISTORY_REACH && cells.length < most; i--) {
    const head = HISTORY_QUESTION.exec(texts[i]!);
    if (head === null) continue;
    let at = skipBlanksDown(texts, i + 1);
    const options: string[] = [];
    while (at >= 0 && at < texts.length) {
      const option = HISTORY_OPTION.exec(texts[at]!);
      if (option === null) break;
      options.push(option[1]!.trim());
      at++;
    }
    if (options.length === 0) break;
    cells.push({ question: head[1]!.trim(), options });
  }
  return cells;
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
  // The newest cells are the queued ones: as many as the reminder counts, oldest first, one per row.
  const cells = historyCells(texts, start, found.count);
  const questions = cells.length === found.count ? cells.map((cell) => cell.question).toReversed().join("\n") : null;
  return {
    startLine: start,
    endLine: found.last,
    model: {
      // The questions the transcript printed for it, or the reminder's own words without their ticking age.
      title: questions ?? texts[found.first]!.trim().replace(/^\?\s*/, "").replace(/\s+·\s+\d+[smh]$/, ""),
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
/** The footer's second row while more than one question waits. */
const PANEL_NEXT = /^\s*shift\+← next question$/;
/** The run's place over the question while more than one waits: `1 of 2`. */
const PANEL_STEP = /^ {2}(\d{1,2}) of (\d{1,2})$/;
// The pointed row leads with `  › `, the others with four spaces.
const PANEL_OPTION = /^(?:\s{2}(›) |\s{4})([1-9])\. (\S.*)$/;
/** An option label that wrapped onto the next row, indented past the number. */
const PANEL_CONTINUATION = /^ {7,}\S/;
const OTHER = "Other";
/** How many rows up from the question the queue's head may sit (blank rows between). */
const HEAD_REACH = 4;

/** The question Codex opened from its queue, at the tail, or null. */
export function detectAsyncPanel(lines: StyledLine[]): AsyncPanelRegion | null {
  const texts = lines.map((l) => rstrip(lineText(l)));
  const fi = lastNonBlankIndex(texts);
  // More than one question waiting adds a row under the footer, straight under it.
  const footer = fi >= 1 && PANEL_NEXT.test(texts[fi]!) ? fi - 1 : fi;
  if (footer < 3 || !PANEL_FOOTER.test(texts[footer]!)) return null;
  const bottom = skipBlanksUp(texts, footer - 1);
  if (bottom < 0) return null;

  // The option run, read upwards: a row that is not an option is a wrapped label of the option above it.
  const rows: { digit: string; label: string; pointed: boolean; line: number }[] = [];
  let pending: string[] = [];
  let i = bottom;
  for (; i >= 0; i--) {
    const text = texts[i]!;
    const option = PANEL_OPTION.exec(text);
    if (option !== null) {
      rows.unshift({ digit: option[2]!, label: [option[3]!.trim(), ...pending].join(" "), pointed: option[1] !== undefined, line: i });
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
  // `1 of 2` heads the question while more than one waits: the card's place in the run, not its words.
  const stepMatch = top < questionEnd ? PANEL_STEP.exec(texts[top]!) : null;
  const regionTop = top;
  if (stepMatch !== null) top++;
  const step = stepMatch === null ? undefined : { index: Number(stepMatch[1]), total: Number(stepMatch[2]) };
  if (step !== undefined && (step.index < 1 || step.index > step.total)) return null;
  // The queue's head stands above the question: what proves this is the queue's question and not a
  // look-alike list printed by something else.
  let head = regionTop - 1;
  while (head >= 0 && regionTop - head <= HEAD_REACH && texts[head]!.trim() === "") head--;
  if (head < 0 || !QUEUE_HEAD.test(texts[head]!)) return null;

  const question = texts.slice(top, questionEnd + 1).map((row) => row.trim()).join(" ");
  const signature = regionSignature(lines, regionTop, fi + 1);
  if (signature === "") return null;
  const other = otherRow(lines, texts, rows, question, head);
  if (other === null) return null;
  const answers = other === "none" ? rows : rows.slice(0, -1);
  if (answers.length < 1) return null;
  const options: PromptOption[] = answers.map((row) => ({ label: row.label, keys: [row.digit] }));
  const model: PromptModel = {
    question,
    options,
    // `select` pins the caption; the digit alone submits (probed), and the per-option keys say so.
    family: "select",
    // The run's place is part of the question's identity: the first of two and a lone question with
    // the same words are two dialogs.
    coreSignature: step === undefined ? question : `${step.index}/${step.total}\n${question}`,
    signature,
  };
  if (step !== undefined) model.step = step;
  if (other !== "none") model.feedback = other;
  return { startLine: regionTop, model };
}

/** Whether every character of the row after its `N. ` lead is faint: the `Other` placeholder. */
function labelFaint(line: StyledLine): boolean {
  const strong = line.segments.filter((segment) => segment.dim !== true).map((segment) => segment.text).join("");
  return /^\s*(?:›\s*)?[1-9]\.\s*$/.test(strong);
}

/**
 * The last row as Codex's `Other` field, `"none"` when the question has no such row, or null when the
 * screen contradicts itself (nothing is lifted then). The label `Other` is the empty field (faint while
 * the pointer is on it). Any other last row is the field when the transcript's cell for this question
 * lists one answer fewer than the panel has rows: what the person typed stands in the label's place,
 * and a third answer looks the same. A pointed row with no cell in reach is the field marked unproven.
 */
function otherRow(
  lines: StyledLine[],
  texts: readonly string[],
  rows: readonly { digit: string; label: string; pointed: boolean; line: number }[],
  question: string,
  head: number,
): PromptFeedback | "none" | null {
  const last = rows.at(-1)!;
  const line = lines[last.line]!;
  const field = (text: string): PromptFeedback => ({ key: last.digit, focused: last.pointed, text, purpose: "other" });
  if (last.label === OTHER && (!last.pointed || labelFaint(line))) return field("");
  const cell = historyCells(texts, head, 8).find((c) => c.question === question);
  if (cell !== undefined) {
    const sameAnswers = (n: number) => cell.options.length === n && cell.options.every((label, k) => label === rows[k]!.label);
    if (sameAnswers(rows.length - 1)) return field(last.pointed && labelFaint(line) ? "" : last.label);
    if (sameAnswers(rows.length)) return "none";
    return null;
  }
  // No cell in reach: an unpointed row reads as an answer, as before `Other` was read (its digit only
  // moves the pointer, it submits nothing). A pointed one may be the field holding text or a third
  // answer. A short pane scrolls the cell away as soon as the question opens (23 rows: the panel alone
  // takes 12), so the card stays, as the field marked unproven: every answer locks, and only the typing
  // recipe's Enter over the exact words it typed at this row may follow (lib/prompt-action.ts).
  return last.pointed ? { ...field(last.label), unproven: true } : "none";
}
