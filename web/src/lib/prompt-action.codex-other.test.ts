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
import { confirmPromptFeedback, submitPromptFeedback, submitPromptOption } from "./prompt-action";

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

// The same run on a 23-row pane (scratch tmux, 52x23): the transcript's `? Pet?` cell has scrolled away
// before the panel opens, so the typed row is proven by nothing but its place and our own words.
const OPENED_23 = capture("codex--v0172-async-two-panel-23rows--w52.txt");
const FOCUSED_23 = capture("codex--v0172-async-other-focused-23rows--w52.txt");
const TYPED_23 = capture("codex--v0172-async-other-typed-23rows--w52.txt");
const SENT_23 = capture("codex--v0172-async-other-sent-23rows--w52.txt");
const DAY_FOCUSED_23 = capture("codex--v0172-async-other-day-focused-23rows--w52.txt");
const DAY_TYPED_LONG_23 = capture("codex--v0172-async-other-day-typed-long-23rows--w52.txt");
const LONG = "Tuesday afternoon works best for the whole team review";
// The same screen with a plain answer under the pointer in the field's place: words nobody typed.
const THIRD_ANSWER_23 = TYPED_23.replace("Fish 42, maybe 3", "Fish");
// Our words one row up, the second answer gone: the field's row is not where the tapped card had it.
const MOVED_23 = TYPED_23.replace(/ {4}2\. Dog\r\n/, "").replace("› 3. ", "› 2. ");
const keysSent = () => mockSendKeys.mock.calls.map((call) => call[1]);

describe("Codex `Other` on a 23-row pane: the field proven by its row and our exact words", () => {
  it("the variants are what they say: one row moved, and a plain label in the field's place", () => {
    expect(model(MOVED_23).options.map((o) => o.label)).toEqual(["Cat"]);
    expect(model(THIRD_ANSWER_23).feedback).toMatchObject({ key: "3", text: "Fish", unproven: true });
  });

  it("digit, focus, type, the words back at the same row, then Enter bound to that read", async () => {
    const opened = model(OPENED_23);
    mockFetchPane
      .mockResolvedValueOnce(paneWith(OPENED_23))
      .mockResolvedValueOnce(paneWith(FOCUSED_23))
      .mockResolvedValue(paneWith(TYPED_23));
    const res = await submitPromptFeedback({ ...base, prompt: opened, text: TEXT });
    expect(res).toEqual({ status: "sent" });
    expect(mockSendKeys.mock.calls).toEqual([
      ["w1:p1", ["3"], undefined, opened.signature],
      ["w1:p1", ["Enter"], undefined, model(TYPED_23).signature],
    ]);
    expect(mockSendReply.mock.calls).toEqual([["w1:p1", TEXT, false, undefined]]);
  });

  it("a long answer that wrapped: its joined words match, and Enter goes", async () => {
    const opened = model(SENT_23);
    mockFetchPane
      .mockResolvedValueOnce(paneWith(SENT_23))
      .mockResolvedValueOnce(paneWith(DAY_FOCUSED_23))
      .mockResolvedValue(paneWith(DAY_TYPED_LONG_23));
    expect(await submitPromptFeedback({ ...base, prompt: opened, text: LONG })).toEqual({ status: "sent" });
    expect(keysSent()).toEqual([["3"], ["Enter"]]);
  });

  it("other words in the row than the ones typed: no Enter, and the person is told the text waits there", async () => {
    mockFetchPane
      .mockResolvedValueOnce(paneWith(OPENED_23))
      .mockResolvedValueOnce(paneWith(FOCUSED_23))
      .mockResolvedValue(paneWith(TYPED_23));
    const res = await submitPromptFeedback({ ...base, prompt: model(OPENED_23), text: "Fish 42" });
    expect(res).toEqual({ status: "error", error: expect.stringContaining("field") });
    expect(keysSent()).toEqual([["3"]]);
  });

  it("our words on another row: no Enter", async () => {
    mockFetchPane
      .mockResolvedValueOnce(paneWith(OPENED_23))
      .mockResolvedValueOnce(paneWith(FOCUSED_23))
      .mockResolvedValue(paneWith(MOVED_23));
    expect((await submitPromptFeedback({ ...base, prompt: model(OPENED_23), text: TEXT })).status).toBe("error");
    expect(keysSent()).toEqual([["3"]]);
  });

  it("a plain label in the field's place after the digit: nothing typed, no Enter", async () => {
    mockFetchPane
      .mockResolvedValueOnce(paneWith(OPENED_23))
      .mockResolvedValue(paneWith(THIRD_ANSWER_23));
    expect((await submitPromptFeedback({ ...base, prompt: model(OPENED_23), text: TEXT })).status).toBe("error");
    expect(keysSent()).toEqual([["3"]]);
    expect(mockSendReply).not.toHaveBeenCalled();
  });

  it("a plain label in the field's place after typing: no Enter", async () => {
    mockFetchPane
      .mockResolvedValueOnce(paneWith(OPENED_23))
      .mockResolvedValueOnce(paneWith(FOCUSED_23))
      .mockResolvedValue(paneWith(THIRD_ANSWER_23));
    expect((await submitPromptFeedback({ ...base, prompt: model(OPENED_23), text: TEXT })).status).toBe("error");
    expect(keysSent()).toEqual([["3"]]);
  });

  it("the panel closed after typing: no Enter", async () => {
    mockFetchPane
      .mockResolvedValueOnce(paneWith(OPENED_23))
      .mockResolvedValueOnce(paneWith(FOCUSED_23))
      .mockResolvedValue(paneWith(capture("codex--v0172-async-answered--w52.txt")));
    expect((await submitPromptFeedback({ ...base, prompt: model(OPENED_23), text: TEXT })).status).toBe("error");
    expect(keysSent()).toEqual([["3"]]);
  });

  it("the bridge refuses the bound Enter: an error that says the text waits in the field", async () => {
    mockFetchPane
      .mockResolvedValueOnce(paneWith(OPENED_23))
      .mockResolvedValueOnce(paneWith(FOCUSED_23))
      .mockResolvedValue(paneWith(TYPED_23));
    mockSendKeys.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, code: "prompt_changed", error: "moved" });
    const res = await submitPromptFeedback({ ...base, prompt: model(OPENED_23), text: TEXT });
    expect(res.status).toBe("error");
    expect(keysSent()).toEqual([["3"], ["Enter"]]);
  });

  it("an unproven field refuses every answer button and a second typing", async () => {
    const typed = model(TYPED_23);
    expect(await submitPromptOption({ ...base, prompt: typed, option: typed.options[0]! })).toEqual({ status: "changed" });
    expect(await submitPromptFeedback({ ...base, prompt: typed, text: TEXT })).toEqual({ status: "changed" });
    expect(mockSendKeys).not.toHaveBeenCalled();
  });
});

describe("sending again a Codex `Other` answer the phone typed and could not send", () => {
  it("Enter alone, bound to a fresh read that shows exactly those words at the row", async () => {
    const typed = model(TYPED_23);
    mockFetchPane.mockResolvedValue(paneWith(TYPED_23));
    expect(await confirmPromptFeedback({ ...base, prompt: typed, text: TEXT })).toEqual({ status: "sent" });
    expect(mockSendKeys.mock.calls).toEqual([["w1:p1", ["Enter"], undefined, typed.signature]]);
    expect(mockSendReply).not.toHaveBeenCalled();
  });

  it("other words on the card than the ones remembered: nothing", async () => {
    mockFetchPane.mockResolvedValue(paneWith(TYPED_23));
    expect(await confirmPromptFeedback({ ...base, prompt: model(TYPED_23), text: "Fish" })).toEqual({ status: "changed" });
    expect(mockSendKeys).not.toHaveBeenCalled();
  });

  it("the field changed since the card was drawn (someone typed at the terminal): no Enter", async () => {
    mockFetchPane.mockResolvedValue(paneWith(THIRD_ANSWER_23));
    expect((await confirmPromptFeedback({ ...base, prompt: model(TYPED_23), text: TEXT })).status).toBe("error");
    expect(mockSendKeys).not.toHaveBeenCalled();
  });

  it("an empty or unfocused field: nothing", async () => {
    expect(await confirmPromptFeedback({ ...base, prompt: model(OPENED_23), text: TEXT })).toEqual({ status: "changed" });
    expect(await confirmPromptFeedback({ ...base, prompt: model(FOCUSED_23), text: TEXT })).toEqual({ status: "changed" });
    expect(mockSendKeys).not.toHaveBeenCalled();
    expect(mockFetchPane).not.toHaveBeenCalled();
  });
});
