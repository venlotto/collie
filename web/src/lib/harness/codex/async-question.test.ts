import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAnsi } from "../../ansi";
import { splitLines, type StyledLine } from "../../blocks";
import { queuedQuestion } from "../../pending-question";
import { liftAsk, readerBlocks } from "../../surface/lift";
import { blockOwnsKeyboard } from "../dialog-contract";
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
  it("lifts a select card: one button per answer, the digit alone, and no `Other`", () => {
    const region = detectAsyncPanel(PANEL)!;
    expect(region.model.question).toBe("Tabs or spaces?");
    expect(region.model.options).toEqual([
      { label: "Tabs", keys: ["1"] },
      { label: "Spaces", keys: ["2"] },
    ]);
    expect(region.model.family).toBe("select");
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
