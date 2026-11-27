import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAnsi } from "../../ansi";
import { splitLines, type StyledLine } from "../../blocks";
import { queuedQuestion } from "../../pending-question";
import { liftAsk, readerBlocks } from "../../surface/lift";
import { blockOwnsKeyboard } from "../dialog-contract";
import { promptsSameIdentity } from "../prompt-model";
import { detectAsyncPanel, detectQueuedQuestion } from "./async-question";
import { codexAdapter } from "./index";
import { lineText } from "./markers";

// Codex 0.172.0 on a disposable Herdr pane, 52 columns, read with `pane read --format ansi`.
const capture = (name: string) => readFileSync(join(import.meta.dirname, "../../../fixtures/panes", name), "utf8");
const linesOf = (text: string): StyledLine[] => splitLines(parseAnsi(text));
const QUEUED = linesOf(capture("codex--v0172-async-question--w52.txt"));
const PANEL = linesOf(capture("codex--v0172-async-panel--w52.txt"));
const ANSWERED = linesOf(capture("codex--v0172-async-answered--w52.txt"));

describe("the reminder over the live box (`? 1 question`, `shift+← to answer`)", () => {
  it("lifts a notice card whose one key is the key the row prints", () => {
    const region = detectQueuedQuestion(QUEUED)!;
    expect(region).not.toBeNull();
    expect(region.model.title).toBe("Tabs or spaces?");
    expect(region.model.actions).toEqual([{ label: "Answer", keys: ["shift+Left"] }]);
    expect(region.model.liveBox).toEqual({ draft: false, queued: 1 });
    expect(lineText(QUEUED[region.startLine]!).trim()).toBe("• Queued follow-up inputs");
    expect(lineText(QUEUED[region.endLine]!).trim()).toBe("shift+← to answer");
  });

  it("leaves the keyboard to the box: no ask is lifted and the composer stays ready", () => {
    const blocks = codexAdapter.buildBlocks(QUEUED);
    expect(blocks.map((b) => b.kind)).toEqual(["raw", "menu"]);
    expect(blocks.some(blockOwnsKeyboard)).toBe(false);
    expect(liftAsk(readerBlocks(QUEUED, "codex"), 0)).toBeNull();
    expect(codexAdapter.composerReady!(QUEUED)).toBe(true);
  });

  it("takes the reminder's rows out of the mirror, and keeps the transcript", () => {
    const [raw] = codexAdapter.buildBlocks(QUEUED);
    const text = raw!.lines.map(lineText).join("\n");
    expect(text).not.toContain("shift+← to answer");
    expect(text).toContain("? Tabs or spaces?");
  });

  it("binds from the key row down to the prompt row, past the count row's ticking age", () => {
    const region = detectQueuedQuestion(QUEUED)!;
    const signature = region.model.signature;
    expect(signature.startsWith("    shift+← to answer")).toBe(true);
    expect(signature.endsWith("› Ask Codex to do anything")).toBe(true);
    expect(signature).not.toContain("1 question");
  });

  it("holds its key while the box holds a draft (the key would move the caret)", () => {
    const withDraft = QUEUED.map((line) =>
      lineText(line).includes("Ask Codex to do anything") ? linesOf("› tabs please")[0]! : line,
    );
    expect(detectQueuedQuestion(withDraft)?.model.liveBox?.draft).toBe(true);
  });

  it("is not lifted when a row of output stands between the reminder and the box", () => {
    const at = QUEUED.findIndex((line) => lineText(line).includes("shift+← to answer"));
    const spliced = [...QUEUED.slice(0, at + 1), ...linesOf("• Ran ls"), ...QUEUED.slice(at + 1)];
    expect(detectQueuedQuestion(spliced)).toBeNull();
  });

  it("is gone once the question was answered", () => {
    expect(detectQueuedQuestion(ANSWERED)).toBeNull();
    expect(codexAdapter.buildBlocks(ANSWERED).map((b) => b.kind)).toEqual(["raw"]);
  });
});

describe("the question the key opens", () => {
  it("lifts a select card: one button per answer, the digit alone, and `Other` as its text field", () => {
    const region = detectAsyncPanel(PANEL)!;
    expect(region.model.question).toBe("Tabs or spaces?");
    expect(region.model.options).toEqual([
      { label: "Tabs", keys: ["1"] },
      { label: "Spaces", keys: ["2"] },
    ]);
    expect(region.model.family).toBe("select");
    expect(region.model.feedback).toEqual({ key: "3", focused: false, text: "", purpose: "other" });
    expect(region.model.step).toBeUndefined();
  });

  it("is the Surface's ask, so the bridge answers it by id", () => {
    const ask = liftAsk(readerBlocks(PANEL, "codex"), 0);
    expect(ask?.kind).toBe("question");
    expect(ask?.options.map((o) => o.label)).toEqual(["Tabs", "Spaces"]);
  });

  it("needs the queue's head above it: the same list printed elsewhere is not lifted", () => {
    const headless = PANEL.map((line) => (lineText(line).includes("Queued follow-up inputs") ? linesOf("• Ran ls")[0]! : line));
    expect(detectAsyncPanel(headless)).toBeNull();
  });
});

describe("the reminder's rows (lib/pending-question.ts, which the bridge reads too)", () => {
  it.each([
    [["• Queued follow-up inputs", "  ? 1 question", "    shift+← to answer"], { first: 1, last: 2, count: 1 }],
    [["  ? 2 questions · 11s", "    shift+← to answer"], { first: 0, last: 1, count: 2 }],
    [["  ? 1 question — shift+← to answer"], { first: 0, last: 0, count: 1 }],
  ])("%j", (rows, expected) => {
    expect(queuedQuestion(rows)).toEqual(expected);
  });

  it.each([
    [["? Tabs or spaces?", "  • Tabs"]],
    [["  ? 1 question"]],
    [["  ? 0 questions", "    shift+← to answer"]],
  ])("not a reminder: %j", (rows) => {
    expect(queuedQuestion(rows)).toBeNull();
  });
});

// Codex 0.172.0 on a scratch tmux server, 52 and 60 columns, read with `capture-pane -e -p` (2026-11-27): one
// `request_user_input_async` call with two questions, and the `Other` row probed by hand.
const TWO_REMINDER = linesOf(capture("codex--v0172-async-two-reminder--w52.txt"));
const TWO_PANEL = linesOf(capture("codex--v0172-async-two-panel--w52.txt"));
const TWO_NEXT = linesOf(capture("codex--v0172-async-two-next--w60.txt"));
const OTHER_FOCUSED = linesOf(capture("codex--v0172-async-other-focused--w52.txt"));
const OTHER_TYPED = linesOf(capture("codex--v0172-async-other-typed--w52.txt"));
const OTHER_SENT = linesOf(capture("codex--v0172-async-other-sent--w52.txt"));

describe("two questions at once (`? 2 questions`)", () => {
  it("the reminder names both questions, in the order they were asked, and keeps its one key", () => {
    const region = detectQueuedQuestion(TWO_REMINDER)!;
    expect(region).not.toBeNull();
    expect(region.model.title).toBe("Pet?\nDay?");
    expect(region.model.liveBox).toEqual({ draft: false, queued: 2 });
    expect(region.model.actions).toEqual([{ label: "Answer", keys: ["shift+Left"] }]);
    expect(region.model.signature).not.toContain("2 questions");
  });

  it("the key opens the first: its title, its answers, its place in the run, and `Other`", () => {
    const region = detectAsyncPanel(TWO_PANEL)!;
    expect(region).not.toBeNull();
    expect(region.model.question).toBe("Pet?");
    expect(region.model.options).toEqual([
      { label: "Cat", keys: ["1"] },
      { label: "Dog", keys: ["2"] },
    ]);
    expect(region.model.step).toEqual({ index: 1, total: 2 });
    expect(region.model.feedback).toEqual({ key: "3", focused: false, text: "", purpose: "other" });
    expect(region.model.signature).toContain("shift+← next question");
    expect(lineText(TWO_PANEL[region.startLine]!).trim()).toBe("1 of 2");
  });

  it("is the Surface's ask while it is open", () => {
    expect(liftAsk(readerBlocks(TWO_PANEL, "codex"), 0)?.options.map((o) => o.label)).toEqual(["Cat", "Dog"]);
  });

  it("a digit answers the first, and the second opens alone (the first run: `Color?`, then `Size?`)", () => {
    const region = detectAsyncPanel(TWO_NEXT)!;
    expect(region.model.question).toBe("Size?");
    expect(region.model.options.map((o) => o.label)).toEqual(["Small", "Large"]);
    expect(region.model.step).toBeUndefined();
  });

  it("the two questions are two dialogs: a tap on the first never lands on the second", () => {
    expect(promptsSameIdentity(detectAsyncPanel(TWO_PANEL)!.model, detectAsyncPanel(TWO_NEXT)!.model)).toBe(false);
  });
});

describe("`Other` (its digit focuses a text field in the row; typing fills it; Enter sends)", () => {
  it("focused and empty: the label is faint, the field holds nothing, and the answers lock", () => {
    const model = detectAsyncPanel(OTHER_FOCUSED)!.model;
    expect(model.question).toBe("Pet?");
    expect(model.options.map((o) => o.label)).toEqual(["Cat", "Dog"]);
    expect(model.feedback).toEqual({ key: "3", focused: true, text: "", purpose: "other" });
  });

  it("typed into: the field holds the words exactly, digits included", () => {
    const model = detectAsyncPanel(OTHER_TYPED)!.model;
    expect(model.feedback).toEqual({ key: "3", focused: true, text: "Fish 42, maybe 3", purpose: "other" });
    expect(model.options.map((o) => o.label)).toEqual(["Cat", "Dog"]);
  });

  it("the same dialog all along, so the typing recipe's polls hold", () => {
    const panel = detectAsyncPanel(TWO_PANEL)!.model;
    const focused = detectAsyncPanel(OTHER_FOCUSED)!.model;
    const typed = detectAsyncPanel(OTHER_TYPED)!.model;
    expect(promptsSameIdentity(panel, focused)).toBe(true);
    expect(promptsSameIdentity(focused, typed)).toBe(true);
  });

  it("after Enter the answer is in the transcript and the next question is open", () => {
    const model = detectAsyncPanel(OTHER_SENT)!.model;
    expect(model.question).toBe("Day?");
    expect(model.feedback).toEqual({ key: "3", focused: false, text: "", purpose: "other" });
    const text = OTHER_SENT.map(lineText).join("\n");
    expect(text).toContain("↪ Re: Pet?");
    expect(text).toContain("Fish 42, maybe 3");
  });

  it("a pointed last row that is not faint and that no history cell proves to be `Other` is not read", () => {
    // The transcript's `? Pet?` cell is what says the question has two answers and the third row is the
    // field; without it, a pointed third row could be a third answer, so nothing is lifted.
    const at = OTHER_TYPED.findIndex((line) => lineText(line) === "? Pet?");
    expect(at).toBeGreaterThanOrEqual(0);
    const cut = OTHER_TYPED.map((line, i) => (i === at ? linesOf("• Ran ls")[0]! : line));
    expect(detectAsyncPanel(cut)).toBeNull();
  });
});
