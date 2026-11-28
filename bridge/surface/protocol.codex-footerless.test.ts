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

