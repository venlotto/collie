// A real Codex 0.172.0 capture, 2026-11-28, read-only from a Herdr pane 23 rows tall on coder1 (the
// same screen at the desktop and the iPhone width): a multi-paragraph draft fills the editor to the
// pane's last row and Codex draws no footer under it, no status row, no `?` hint, no warning row. The
// prompt row carries no `↑`: the whole draft is in view. Before the fix every read of it was no-match,
// so the send ended typed_not_submitted and every later send was refused as an unreadable screen.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { idleFor, readScreen, rowsOf } from "../../web/src/test/surface-corpus";
import { inputFrameOf } from "../../web/src/lib/surface/fold";
import { boxHolds } from "./protocol";
import { FakePane, rig, useScratchDir } from "./protocol.rig";

useScratchDir();
const capture = readFileSync(join(import.meta.dirname, "captures/codex--v0172-footerless-draft--herdr.txt"), "utf8");
const message = readFileSync(join(import.meta.dirname, "captures/codex--v0172-footerless-draft--message.txt"), "utf8").trimEnd();

/** A pane that draws the real footerless capture while its box holds exactly the message. */
function footerlessPane(): FakePane {
  const pane = new FakePane("codex");
  // The rows over the box as the capture shows them: the header Codex prints at start.
  pane.transcript = capture.split("\n").slice(0, 6);
  pane.blockLiteralLines = 100;
  pane.collapseOver = 1000;
  const original = pane.render.bind(pane);
  pane.render = () => (pane.box === message ? capture : original());
  return pane;
}

describe("Codex's whole draft with no footer under it, in a 23-row pane", () => {
  test("the real capture reads idle, no dialog, a draft, and holds the whole message", () => {
    const rows = rowsOf(capture);
    const idle = idleFor("codex")!;
    expect(readScreen(rows, "codex", idle).surface).toEqual({ revision: 1, turn: "idle", modal: "none", composer: "draft" });
    const frame = inputFrameOf(rows, idle);
    expect(frame?.bottomClipped).toBe(true);
    expect(frame?.scrolled).toBeUndefined();
    expect(boxHolds(frame!, "", message.split("\n"), null, null)).toBe("all");
    expect(boxHolds(frame!, "", [message.replace("OK-CAP", "OK-XXX")], null, null)).toBeNull();
    expect(boxHolds(frame!, "", [message.slice(0, -3)], null, null)).toBeNull();
  });

  test("the paste reaches Enter, the submit is confirmed, and a second send goes out too", async () => {
    const pane = footerlessPane();
    const r = rig({ pane, harness: "codex", version: "0.172.0", block: true });
    const answer = await r.send(message);
    expect(answer.receipt?.outcome, JSON.stringify(answer)).toBe("sent");
    expect(pane.calls.filter((call) => call === `block:${message}`)).toHaveLength(1);
    expect(pane.keysSeen.filter((key) => key === "Enter" || key === "Tab")).toEqual(["Enter"]);
    expect(pane.box).toBe("");

    const next = await r.send("Responde solo OK.");
    expect(next.receipt?.outcome, JSON.stringify(next)).toBe("sent");
    expect(pane.keysSeen.filter((key) => key === "Enter" || key === "Tab")).toEqual(["Enter", "Enter"]);
  });

  test("Submit after a typed_not_submitted presses Enter on the box and types nothing again", async () => {
    const pane = footerlessPane();
    pane.box = message;
    const answer = await rig({ pane, harness: "codex", version: "0.172.0", block: true }).send(message, { mode: "submit" });
    expect(answer.receipt?.outcome, JSON.stringify(answer)).toBe("sent");
    expect(pane.keysSeen).toEqual(["Enter"]);
    expect(pane.calls.filter((call) => /^(?:block|paste|type):/u.test(call))).toEqual([]);
  });

  test("a draft the person typed at the desk in the same shape is a draft, never sent for them", async () => {
    const pane = footerlessPane();
    pane.box = message;
    const answer = await rig({ pane, harness: "codex", version: "0.172.0", block: true }).send("Otra cosa.");
    expect(answer.receipt).toMatchObject({ outcome: "refused", reason: "draft_present" });
    // The draft probe (its character, then Backspace) is the only key, as over any Codex draft.
    expect(pane.keysSeen.filter((key) => key === "Enter" || key === "Tab")).toEqual([]);
    expect(pane.box).toBe(message);
  });

  test("a footerless box that does not hold the typed text is never submitted", async () => {
    const pane = footerlessPane();
    const altered = capture.replace("OK-CAP", "OK-XYZ");
    pane.render = () => (pane.box === message ? altered : FakePane.prototype.render.call(pane));
    const answer = await rig({ pane, harness: "codex", version: "0.172.0", block: true }).send(message);
    expect(answer.receipt?.outcome).toBe("typed_not_submitted");
    expect(pane.keysSeen.filter((key) => key === "Enter" || key === "Tab")).toEqual([]);
  });
});

// The same draft on a screen no layout reads at all: a transcript row stands where the box's blank top
// row would be, so no frame closes and every read is no-match. It stands for any footerless shape a
// later Codex draws that the profile does not name yet.
const lines = capture.split("\n");
const blankTop = lines.findIndex((row) => row.startsWith("\u001b[0m\u001b[1m›")) - 1;
const unread = lines.map((row, i) => (i === blankTop ? "• Ran echo listo" : row)).join("\n");

/** A pane that draws `screen` while its box holds exactly the message, and the rig's own box otherwise. */
function unreadPane(screen: () => string): FakePane {
  const pane = new FakePane("codex");
  pane.transcript = capture.split("\n").slice(0, 6);
  pane.blockLiteralLines = 100;
  pane.collapseOver = 1000;
  const original = pane.render.bind(pane);
  pane.render = () => (pane.box === message ? screen() : original());
  return pane;
}

describe("Collie's own text alone at the end of a screen no layout reads", () => {
  test("the screen is no-match with no cue: no frame, and nothing reads it as free", () => {
    const rows = rowsOf(unread);
    const idle = idleFor("codex")!;
    expect(inputFrameOf(rows, idle)).toBeNull();
    expect(readScreen(rows, "codex", idle).surface).toMatchObject({ modal: "unknown", composer: "unknown", reason: "no-match" });
  });

  test("the send re-reads its own text there, presses only Tab, and a second send goes out", async () => {
    const pane = unreadPane(() => unread);
    const r = rig({ pane, harness: "codex", version: "0.172.0", block: true });
    const answer = await r.send(message);
    expect(answer.receipt?.outcome, JSON.stringify(answer)).toBe("sent");
    expect(pane.calls.filter((call) => call === `block:${message}`)).toHaveLength(1);
    expect(pane.keysSeen.filter((key) => key === "Enter" || key === "Tab")).toEqual(["Tab"]);
    expect(pane.box).toBe("");
    const next = await r.send("Responde solo OK.");
    expect(next.receipt?.outcome, JSON.stringify(next)).toBe("sent");
  });

  test("a later send of the same text finishes it with Tab and pastes nothing again", async () => {
    let torn = true;
    const pane = unreadPane(() => (torn ? unread.replace("OK-CAP", "OK-C") : unread));
    const r = rig({ pane, harness: "codex", version: "0.172.0", block: true });
    expect((await r.send(message)).receipt?.outcome).toBe("typed_not_submitted");
    expect(pane.keysSeen.filter((key) => key === "Enter" || key === "Tab")).toEqual([]);
    torn = false;
    const retry = await r.send(message);
    expect(retry.receipt?.outcome, JSON.stringify(retry)).toBe("sent");
    expect(pane.calls.filter((call) => call === `block:${message}`)).toHaveLength(1);
    expect(pane.keysSeen.filter((key) => key === "Enter" || key === "Tab")).toEqual(["Tab"]);
  });

  test("another text is refused as a draft, never typed after it and never submitting it", async () => {
    let torn = true;
    const pane = unreadPane(() => (torn ? unread.replace("OK-CAP", "OK-C") : unread));
    const r = rig({ pane, harness: "codex", version: "0.172.0", block: true });
    expect((await r.send(message)).receipt?.outcome).toBe("typed_not_submitted");
    torn = false;
    const keysBefore = pane.keysSeen.length;
    const callsBefore = pane.calls.length;
    const other = await r.send("Otra pregunta, por favor.");
    expect(other.receipt).toMatchObject({ outcome: "refused", reason: "draft_present" });
    expect(pane.keysSeen.slice(keysBefore)).toEqual([]);
    expect(pane.calls.slice(callsBefore).filter((call) => /^(?:block|paste|type|keys?):/u.test(call))).toEqual([]);
    expect(pane.box).toBe(message);
  });

  test("the same screen with a text Collie never typed is still refused as unreadable, with no key", async () => {
    const pane = unreadPane(() => unread);
    pane.box = message;
    const answer = await rig({ pane, harness: "codex", version: "0.172.0", block: true }).send(message);
    expect(answer.receipt).toMatchObject({ outcome: "refused", reason: "unconfirmed" });
    expect(pane.keysSeen).toEqual([]);
  });

  for (const [name, below] of [
    ["question card", ["", "  Question 1/1 (1 unanswered)", "  › 1. Apple (Recommended)", "    2. Pear", "  tab to add notes | enter to submit answer | esc to interrupt"]],
    ["approval", ["", "› 1. Yes, proceed (y)", "  2. No, and tell Codex what to do differently", "  Press enter to confirm or esc to cancel"]],
    ["hint row", ["  ? for shortcuts"]],
  ] as const) {
    test(`a ${name} under the typed text gets no submit key`, async () => {
      const shown = [...unread.split("\n").slice(below.length), ...below].join("\n");
      const pane = unreadPane(() => shown);
      const answer = await rig({ pane, harness: "codex", version: "0.172.0", block: true }).send(message);
      expect(answer.receipt?.outcome).not.toBe("sent");
      expect(pane.keysSeen.filter((key) => key === "Enter" || key === "Tab")).toEqual([]);
    });
  }
});
