import { describe, expect, it, beforeEach, vi } from "vitest";

// Codex 0.172.0's async question `Other` row, typed into from the phone (captures of 2026-11-27, a
// scratch tmux server at 52 columns, codex/ASYNC_QUESTION_NOTES.md): its digit moves the pointer onto the
// row, the typed words stand in the faint label's place, and Enter sends them as the answer. The same
// recipe as Claude's plan field (prompt-action.test.ts), driven here by the real captures.
vi.mock("./api", () => ({
  fetchPane: vi.fn(),
  sendKeys: vi.fn(),
  sendReply: vi.fn(),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPane, sendKeys, sendReply } from "./api";
import { parseAnsi } from "./ansi";
import { splitLines } from "./blocks";
import { detectAsyncPanel } from "./harness/codex/async-question";
import { submitPromptFeedback, submitPromptOption } from "./prompt-action";

const mockFetchPane = vi.mocked(fetchPane);
const mockSendKeys = vi.mocked(sendKeys);
const mockSendReply = vi.mocked(sendReply);

const capture = (name: string) => readFileSync(join(import.meta.dirname, "../fixtures/panes", name), "utf8");
// The first of two questions as `shift+Left` opened it, pointer on its first answer, then the same run.
const OPENED = capture("codex--v0172-async-two-panel--w52.txt");
const FOCUSED = capture("codex--v0172-async-other-focused--w52.txt");
const TYPED = capture("codex--v0172-async-other-typed--w52.txt");
const TEXT = "Fish 42, maybe 3";

const model = (text: string) => {
  const region = detectAsyncPanel(splitLines(parseAnsi(text)));
  if (region === null) throw new Error("the capture did not detect");
  return region.model;
};
const paneWith = (text: string, revision = 5) => ({ paneId: "w1:p1", text, truncated: false, revision });
const base = { paneId: "w1:p1", requestedLines: 600, detectedRevision: 5, agent: "codex", sleep: async () => {} };

beforeEach(() => {
  mockFetchPane.mockReset();
  mockSendKeys.mockReset();
  mockSendReply.mockReset();
  mockSendKeys.mockResolvedValue({ ok: true });
  mockSendReply.mockResolvedValue({ ok: true });
});

describe("Codex `Other`: digit → the field focused and empty → type → the words on screen → Enter", () => {
  it("runs the sequence and sends Enter only after the words read back exactly", async () => {
    const opened = model(OPENED);
    mockFetchPane
      .mockResolvedValueOnce(paneWith(OPENED))
      .mockResolvedValueOnce(paneWith(FOCUSED))
      .mockResolvedValue(paneWith(TYPED));
    const res = await submitPromptFeedback({ ...base, prompt: opened, text: TEXT });
    expect(res).toEqual({ status: "sent" });
    expect(mockSendKeys.mock.calls).toEqual([
      ["w1:p1", ["3"], undefined, opened.signature],
      ["w1:p1", ["Enter"], undefined, model(TYPED).signature],
    ]);
    expect(mockSendReply.mock.calls).toEqual([["w1:p1", TEXT, false, undefined]]);
  });

  it("types nothing and sends no Enter when the field never shows focused and empty", async () => {
    mockFetchPane.mockResolvedValueOnce(paneWith(OPENED)).mockResolvedValue(paneWith(OPENED));
    const res = await submitPromptFeedback({ ...base, prompt: model(OPENED), text: TEXT });
    expect(res.status).toBe("error");
    expect(mockSendKeys.mock.calls).toEqual([["w1:p1", ["3"], undefined, model(OPENED).signature]]);
    expect(mockSendReply).not.toHaveBeenCalled();
  });

  it("sends no Enter when other words than the person's read back", async () => {
    mockFetchPane
      .mockResolvedValueOnce(paneWith(OPENED))
      .mockResolvedValueOnce(paneWith(FOCUSED))
      .mockResolvedValue(paneWith(TYPED));
    const res = await submitPromptFeedback({ ...base, prompt: model(OPENED), text: "Fish 42" });
    expect(res.status).toBe("error");
    expect(mockSendKeys.mock.calls.map((call) => call[1])).toEqual([["3"]]);
  });

  it("refuses before any key while the field is focused (someone is typing in it) or holds text", async () => {
    expect(await submitPromptFeedback({ ...base, prompt: model(FOCUSED), text: TEXT })).toEqual({ status: "changed" });
    expect(await submitPromptFeedback({ ...base, prompt: model(TYPED), text: TEXT })).toEqual({ status: "changed" });
    expect(mockSendKeys).not.toHaveBeenCalled();
    expect(mockSendReply).not.toHaveBeenCalled();
  });

  it("an answer button refuses while the field has the pointer: its digit would be typed as text", async () => {
    const focused = model(FOCUSED);
    expect(await submitPromptOption({ ...base, prompt: focused, option: focused.options[0]! })).toEqual({ status: "changed" });
    expect(mockSendKeys).not.toHaveBeenCalled();
  });
});
