// Real Codex 0.172.0 captures, 2026-11-28, private tmux panes at 23x52 and 23x56.
// The 56-column capture includes a working turn and two already queued messages.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { idleFor, readScreen, rowsOf } from "../../web/src/test/surface-corpus";
import { inputFrameOf } from "../../web/src/lib/surface/fold";
import { boxHolds, SendProtocol } from "./protocol";
import { FakePane, rig, useScratchDir } from "./protocol.rig";

useScratchDir();
const capture = readFileSync(join(import.meta.dirname, "captures/codex--v0172-scrolled-paragraphs--w52.txt"), "utf8");
const message = readFileSync(join(import.meta.dirname, "captures/codex--v0172-scrolled-paragraphs--message.txt"), "utf8").trimEnd();

describe("Codex's scrolled editor in a 23-row pane", () => {
  test("the real footerless capture is a draft, with only its visible tail", () => {
    const rows = rowsOf(capture);
    const idle = idleFor("codex")!;
    expect(readScreen(rows, "codex", idle).surface).toMatchObject({ modal: "none", composer: "draft" });
    const frame = inputFrameOf(rows, idle);
    expect(frame?.scrolled).toBe(true);
    expect(frame?.interior.text).not.toContain("↑");
    expect(frame).not.toBeNull();
    expect(boxHolds(frame!, "", message.split("\n"), null, null)).toBe("tail");
    expect(boxHolds(frame!, "", [message + " altered"], null, null)).toBeNull();
  });

  test("one block reaches Enter when its tail scrolls and the footer disappears", async () => {
    const pane = new FakePane("codex");
    pane.transcript = capture.split("\n").slice(0, 6);
    pane.codexStatus = "  GPT-6-Astra high · ~/codexp-stability · Revisa el\n  editor largo";
    pane.blockLiteralLines = 100;
    pane.collapseOver = 1000;
    const original = pane.render.bind(pane);
    pane.render = () => pane.box === message ? capture : original();
    const answer = await rig({ pane, harness: "codex", version: "0.172.0", block: true }).send(message);
    expect(answer.receipt?.outcome, JSON.stringify(answer)).toBe("sent");
    expect(pane.keysSeen.filter(key => key === "Enter" || key === "Tab")).toEqual(["Enter"]);
    expect(pane.calls.filter(call => call === `block:${message}`)).toHaveLength(1);
    expect(pane.box).toBe("");
  });
  test("Submit recovers the visible tail with Enter and never pastes it again", async () => {
    const pane = new FakePane("codex");
    pane.box = message;
    const original = pane.render.bind(pane);
    pane.render = () => pane.box === message ? capture : original();
    const answer = await rig({ pane, harness: "codex", version: "0.172.0", block: true }).send(message, { mode: "submit" });
    expect(answer.receipt?.outcome, JSON.stringify(answer)).toBe("sent");
    expect(pane.keysSeen).toEqual(["Enter"]);
    expect(pane.calls.filter(call => /^(?:block|paste|type):/u.test(call))).toEqual([]);
  });

  test("a cut screen without the marker, an approval, and a changed tail cannot borrow this frame", () => {
    const idle = idleFor("codex")!;
    for (const text of [capture.replace("↑", " "), capture.replace("›", "› 1. Yes, proceed"), capture + "Not an editor row"]) {
      expect(inputFrameOf(rowsOf(text), idle)).toBeNull();
    }
    const frame = inputFrameOf(rowsOf(capture.replace("Párrafo 5", "Párrafo X")), idle);
    expect(frame).not.toBeNull();
    expect(boxHolds(frame!, "", message.split("\n"), null, null)).toBeNull();
  });

  test("the real 56-column capture keeps the running turn and its queue above the draft", () => {
    const rows = rowsOf(readFileSync(join(import.meta.dirname, "captures/codex--v0172-scrolled-paragraphs--w56.txt"), "utf8"));
    const text = readFileSync(join(import.meta.dirname, "captures/codex--v0172-scrolled-paragraphs--w56-message.txt"), "utf8");
    const idle = idleFor("codex")!;
    expect(readScreen(rows, "codex", idle).surface).toMatchObject({ modal: "none", composer: "draft", turn: "running" });
    const frame = inputFrameOf(rows, idle);
    expect(frame?.bottomClipped).toBe(true);
    expect(boxHolds(frame!, "", text.split("\n"), null, null)).toBe("tail");
  });

  for (const restart of [false, true]) test(`a retry reoffers Submit for its own scrolled text${restart ? " after restart" : ""}`, async () => {
    const pane = new FakePane("codex");
    pane.blockLiteralLines = 100;
    pane.collapseOver = 1000;
    let torn = true;
    const original = pane.render.bind(pane);
    pane.render = () => pane.box === message ? (torn ? capture.replace("Párrafo 5", "Párrafo X") : capture) : original();
    const r = rig({ pane, harness: "codex", version: "0.172.0", block: true });
    expect((await r.send(message)).receipt?.outcome).toBe("typed_not_submitted");
    torn = false;
    const retry = restart
      ? await new SendProtocol(r.deps).handle({ id: "retry-after-restart", mode: "send", text: message }, { session: "main", paneId: "%1", harness: "codex" })
      : await r.send(message);
    expect(retry.receipt?.outcome).toBe("typed_not_submitted");
    expect(retry.offers).toEqual(["submit", "discard", "keys"]);
    expect(pane.calls.filter(call => call === `block:${message}`)).toHaveLength(1);
    expect(pane.keysSeen.filter(key => key === "Enter" || key === "Tab")).toEqual([]);
  });

  test("an unrelated native scrolled draft never becomes an automatic retry", async () => {
    const pane = new FakePane("codex");
    pane.box = message;
    pane.render = () => capture;
    const answer = await rig({ pane, harness: "codex", version: "0.172.0", block: true }).send(message);
    expect(answer.receipt).toMatchObject({ outcome: "refused", reason: "draft_present" });
    expect(answer.offers).not.toContain("submit");
    expect(pane.keysSeen).toEqual([]);
  });

});
