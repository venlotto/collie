// Claude Code and Codex chat text must arrive as literal paste content, never as terminal hotkeys. The
// fake opens a modal when the message arrives as keystrokes; a bracketed paste is inert. The Claude
// captures pin the real shortcut overlay and the literal question-mark box.

import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { agentOf, fixtureRows, idleFor, readScreen } from "../../web/src/test/surface-corpus.ts";
import { DIALOG, FakePane, PROBE, rig, useScratchDir } from "./protocol.rig.ts";

useScratchDir();

const FIXTURES = fileURLToPath(new URL("fixtures/", import.meta.url));

function codex() {
  const pane = new FakePane("codex");
  // This suite pins transport, not the long-text collapse grammar (zone A). Keep the box literal.
  pane.collapseOver = 10_000;
  pane.blockLiteralLines = Number.POSITIVE_INFINITY;
  pane.afterInput = (p, what) => {
    const rawQuestion = what === "type:?" || what === "paste:?";
    const rawMention = what === "type:@x" || what === "paste:@x";
    if (rawQuestion) p.dialog = DIALOG;
    if (rawMention) p.codexHint = "  file mention popup";
  };
  return rig({ pane, harness: "codex", version: "0.172.0", block: true, linePaste: false });
}

describe("Claude Code 2.1.332 literal keyboard input", () => {
  test("the real captures distinguish the raw-key overlay from a literal pasted question mark", () => {
    const read = (name: string) => readScreen(fixtureRows(name, FIXTURES), agentOf("claude"), idleFor("claude")).surface;
    expect(read("claude--v2332-shortcuts-overlay--w80.txt")).toMatchObject({ modal: "unreadable" });
    expect(read("claude--v2332-question-bracketed-paste--w80.txt")).toMatchObject({ modal: "none", composer: "draft" });
    expect(read("claude--v2332-ready--w54.txt")).toMatchObject({ turn: "idle", modal: "none", composer: "empty" });
  });

  test("? is one bracketed paste, opens no shortcut overlay, and the next short send works", async () => {
    const pane = new FakePane("claude");
    pane.afterInput = (p, what) => {
      if (what === "type:?" || what === "paste:?") p.dialog = DIALOG;
    };
    const { send } = rig({ pane, harness: "claude", version: "2.1.332", block: true, linePaste: false });

    expect((await send("?")).receipt).toMatchObject({ outcome: "sent", keys: ["probe", "Backspace", "Enter"] });
    expect(pane.dialog).toBeNull();
    expect(pane.calls).toEqual([`type:${PROBE}`, "block:?"]);
    expect((await send("responde OK y para")).receipt?.outcome).toBe("sent");
    expect(pane.dialog).toBeNull();
  });
});

describe("Codex 0.172 literal keyboard input", () => {
  test.each(["?", "@x"])("%s is one bracketed paste and opens no hotkey modal", async (text) => {
    const { pane, send } = codex();
    const answer = await send(text);
    expect(answer.receipt).toMatchObject({ outcome: "sent", keys: ["probe", "Backspace", "Enter"] });
    expect(pane.dialog).toBeNull();
    expect(pane.calls).toEqual([`block:${PROBE}`, `block:${text}`]);
    expect(pane.transcript.at(-1)).toBe(`› ${text}`);
  });

  test("a short ordinary message and its probe are both pasted, not typed", async () => {
    const { pane, send } = codex();
    expect((await send("hola")).receipt?.outcome).toBe("sent");
    expect(pane.calls).toEqual([`block:${PROBE}`, "block:hola"]);
  });

  test("a multiline message is one paste and never presses ctrl+j", async () => {
    const { pane, send } = codex();
    const text = "primera línea\nsegunda línea\n\n@x ?";
    expect((await send(text)).receipt?.outcome).toBe("sent");
    expect(pane.calls).toEqual([`block:${PROBE}`, `block:${text}`]);
    expect(pane.keysSeen).not.toContain("ctrl+j");
  });

  test("a long message is one paste and never a sequence of raw characters", async () => {
    const { pane, send } = codex();
    const text = "Revisa @src/app.ts ? ".repeat(20).trim();
    expect((await send(text)).receipt?.outcome).toBe("sent");
    expect(pane.calls).toEqual([`block:${PROBE}`, `block:${text}`]);
  });

  test.each(["/model", "@x", "!ls"])("an explicit %s command keeps its native raw-text command route", async (text) => {
    const { pane, send } = codex();
    const answer = await send(text, { mode: "command" });
    expect(answer.receipt).toMatchObject({ outcome: "sent", keys: ["probe", "Backspace", "Enter"] });
    // Only the probe is neutralised. The command itself must still reach Codex's command parser.
    expect(pane.calls).toEqual([`block:${PROBE}`, `type:${text}`]);
  });

  test("a failed probe is cleaned without opening a modal or leaving its character", async () => {
    const { pane, send } = codex();
    pane.afterInput = (p, what) => {
      if (what === `type:${PROBE}` || what === `block:${PROBE}`) p.codexHint = "  an unexpected modal cue";
    };
    const answer = await send("hola");
    expect(answer.receipt).toMatchObject({ outcome: "refused", reason: "probe_failed" });
    expect(pane.box).toBe("");
    expect(pane.dialog).toBeNull();
    expect(pane.calls[0]).toBe(`block:${PROBE}`);
  });

  test("prepare with an empty draft writes no text and presses no key", async () => {
    const { pane, send } = codex();
    const answer = await send("", { mode: "prepare" });
    expect(answer.receipt).toBeUndefined();
    expect(pane.calls).toEqual([]);
    expect(pane.keysSeen).toEqual([]);
  });
});
