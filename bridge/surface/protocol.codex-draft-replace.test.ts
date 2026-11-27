// Replace over a long draft in Codex 0.172.0 (live, 2026-11-27, codexp `w2D:p7`): the phone offered
// Add / Replace / Cancel over a stuck 376-character draft, and Replace pressed 393 Backspaces, then ended
// unknown(no_evidence) with nothing typed: the box emptied a second later, the new message was never
// written, and the phone said it could not tell whether the message arrived. Codex takes Backspaces
// slower than the clear reads (lab: 393 of them in about 1.5 s at 56 columns, a read 250 ms after a batch
// of 256 still showed seven of the eight rows, captures/codex--v0172-draft-*--w56.txt), and the clear
// gave up at the first read after its last key that still showed text. The fake below takes the keys
// the same way: a number of them per read, not at once.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { muxAck, type MuxAck } from "../mux/types.ts";
import { FakePane, rig, OFFERED, useScratchDir, neverEscape } from "./protocol.rig.ts";

useScratchDir();

const VERSION = "0.172.0";
// The capture's box puts each 46-character sentence on its own row, so a 54-character row does not fit:
// the box takes 53 characters at 56 columns.
const BOX_WIDTH = 53;
const SENTENCE = "Explica en una frase por que el cielo es azul.";
const DRAFT = Array.from({ length: 8 }, () => SENTENCE).join(" ");
const NEW = "Responde solo OK-R2";

/** Codex's word wrap: break at a space and drop it, cut a word longer than the row. */
function codexWrap(line: string, width: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of line.split(/(?<= )/u)) {
    if ((cur + word).trimEnd().length <= width) {
      cur += word;
      continue;
    }
    if (cur !== "") out.push(cur.trimEnd());
    cur = word;
    while (cur.trimEnd().length > width) {
      out.push(cur.slice(0, width));
      cur = cur.slice(width);
    }
  }
  out.push(cur.trimEnd());
  return out;
}

/**
 * Codex 0.172.0 at 56 columns as the lab drew it, taking Backspaces late: each read first takes at most
 * {@link perRead} of the Backspaces that went out, as Codex redraws while it works through them. A
 * {@link stuckAt} box stops taking them once that few characters are left.
 */
class DrainingCodex extends FakePane {
  pending = 0;
  perRead = 60;
  stuckAt: number | null = null;
  constructor() {
    super("codex");
    this.codexStatus = "  gpt-5 default · /tmp/cx-scratch";
    this.collapseOver = Number.MAX_SAFE_INTEGER;
    this.transcript = ["  >_ OpenAI Codex (v0.172.0)", "     /tmp/cx-scratch"];
    const keys = this.writeKeys;
    this.writeKeys = (paneId: string, sent: readonly string[]): Promise<MuxAck> => {
      for (const key of sent) {
        if (key === "Backspace") {
          this.keysSeen.push(key);
          this.pending++;
          continue;
        }
        this.drain(this.pending);
        void keys(paneId, [key]);
      }
      return Promise.resolve(muxAck());
    };
    this.beforeRead = () => this.drain(this.perRead);
  }

  private drain(most: number): void {
    const floor = this.stuckAt ?? 0;
    const chars = [...this.box];
    const take = Math.min(most, this.pending, Math.max(0, chars.length - floor));
    // Backspaces past an empty box do nothing, as Codex's; a stuck box keeps them.
    this.pending = chars.length - take <= floor && this.stuckAt === null ? 0 : this.pending - take;
    if (take === 0) return;
    this.box = chars.slice(0, chars.length - take).join("");
    this.revision++;
  }

  override render(): string {
    if (this.fixed !== null) return this.fixed;
    const rows = [...this.transcript, "", ""];
    if (this.dialog !== null) return [...rows, ...this.dialog].join("\n");
    if (this.box === "") rows.push("\u001b[1m›\u001b[0m \u001b[2mAsk Codex to do anything\u001b[0m");
    else codexWrap(this.box, BOX_WIDTH).forEach((chunk, i) => rows.push(`${i === 0 ? "›" : " "} ${chunk}`));
    rows.push("", this.codexStatus);
    if (this.box === "") rows.push("  ← for agents · ? for shortcuts");
    return rows.join("\n");
  }
}

function codex() {
  const pane = new DrainingCodex();
  pane.box = DRAFT;
  const { send } = rig({ pane, harness: "codex", version: VERSION, block: true });
  return { pane, send };
}

const writes = (pane: FakePane): string[] => pane.calls.filter((call) => (call.startsWith("block:") && call !== "block:⌁") || (call.startsWith("type:") && call.length > "type:x".length));
const capture = (name: string): string => readFileSync(join(import.meta.dirname, "captures", name), "utf8");
// eslint-disable-next-line no-control-regex
const plain = (text: string): string => text.replace(/\u001b\[[0-9;:?]*[ -/]*[@-~]/gu, "");

describe("the captured draft (codex--v0172-draft-*--w56.txt)", () => {
  test("the fake draws the 376-character draft as Codex did", () => {
    const pane = new DrainingCodex();
    pane.box = DRAFT;
    const boxRows = (screen: string): string[] => plain(screen).split("\n").filter((row) => row.includes("Explica"));
    expect(boxRows(pane.render())).toEqual(boxRows(capture("codex--v0172-draft-376--w56.txt")));
  });

  test("the bridge reads the captured screen as a draft in an idle box", async () => {
    const pane = new DrainingCodex();
    pane.fixed = capture("codex--v0172-draft-376--w56.txt");
    const answer = await rig({ pane, harness: "codex", version: VERSION, block: true }).send("", { mode: "prepare" });
    expect(answer.surface).toMatchObject({ composer: "draft", turn: "idle", modal: "none" });
    expect(answer.rowsHash).toBeDefined();
  });

  test("the box a batch of 256 Backspaces left 250 ms later still shows most of the draft", () => {
    const rows = plain(capture("codex--v0172-draft-draining--w56.txt")).split("\n").filter((row) => row.includes("Explica"));
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.join(" ").length).toBeGreaterThan(DRAFT.length - 256);
  });
});

describe("Replace over a long Codex draft (2026-11-27)", () => {
  test("the clear waits while Codex takes its Backspaces, then the new message is typed and sent", async () => {
    const { pane, send } = codex();
    const answer = await send(NEW, { mode: "replace", rowsHash: OFFERED });
    expect(answer.receipt?.outcome).toBe("sent");
    expect(answer.receipt?.gapsMs.clear).toBeGreaterThan(0);
    expect(writes(pane)).toEqual([`block:${NEW}`]);
    expect(pane.transcript.at(-1)).toBe(`› ${NEW}`);
    expect(pane.box).toBe("");
    // The keys are the draft's length plus the profile's slack, never a second round of them.
    expect(pane.keysSeen.filter((key) => key === "Backspace").length).toBeLessThanOrEqual(2 + DRAFT.length + 16);
    neverEscape(pane);
  });

  test("a new message as long as the draft goes as one paste and is sent", async () => {
    const { pane, send } = codex();
    const answer = await send(DRAFT, { mode: "replace", rowsHash: OFFERED });
    expect(answer.receipt?.outcome).toBe("sent");
    expect(writes(pane)).toEqual([`block:${DRAFT}`]);
    expect(pane.transcript.at(-1)).toBe(`› ${DRAFT}`);
    expect(pane.box).toBe("");
  });

  test("a box that stops emptying ends refused (not_emptied) over what is left, and the message is never typed", async () => {
    const { pane, send } = codex();
    pane.stuckAt = 100;
    const answer = await send(NEW, { mode: "replace", rowsHash: OFFERED });
    expect(answer.receipt).toMatchObject({ outcome: "refused", reason: "draft_present" });
    expect(answer.cause).toBe("not_emptied");
    expect(answer.receipt?.detail).toContain("your message was not typed");
    // What is left is offered again, with its rows hash, so a second Replace empties the rest.
    expect(answer.offers).toEqual(["append", "replace", "cancel"]);
    expect(answer.rowsHash).toBeDefined();
    expect([...(answer.draftText ?? "")].length).toBe(100);
    expect(writes(pane)).toEqual([]);
    expect(pane.keysSeen).not.toContain("Tab");
    expect(pane.keysSeen).not.toContain("Enter");
    neverEscape(pane);
  });

  test("the second Replace over what is left empties it and sends", async () => {
    const { pane, send } = codex();
    pane.stuckAt = 100;
    const first = await send(NEW, { mode: "replace", rowsHash: OFFERED });
    expect(first.cause).toBe("not_emptied");
    pane.stuckAt = null;
    pane.pending = 0;
    const again = await send(NEW, { mode: "replace", rowsHash: first.rowsHash });
    expect(again.receipt?.outcome).toBe("sent");
    expect(pane.transcript.at(-1)).toBe(`› ${NEW}`);
    expect(pane.box).toBe("");
  });

  test("a box that goes away while it empties ends refused (not_emptied, not_free), never unknown", async () => {
    const { pane, send } = codex();
    let batches = 0;
    const keys = pane.writeKeys;
    pane.writeKeys = (paneId, sent) => {
      if (sent.length > 1 && ++batches === 1) pane.dialog = [" Do you want to proceed?", " ❯ 1. Yes", "   2. No", " Esc to cancel · Enter to select"];
      return keys(paneId, sent);
    };
    const answer = await send(NEW, { mode: "replace", rowsHash: OFFERED });
    expect(answer.receipt).toMatchObject({ outcome: "refused", reason: "not_free" });
    expect(answer.cause).toBe("not_emptied");
    expect(writes(pane)).toEqual([]);
    neverEscape(pane);
  });
});

describe("Add to it over the same draft", () => {
  test("the text goes after the draft as one paste, and the whole box is sent", async () => {
    const { pane, send } = codex();
    const answer = await send(` ${NEW}`, { mode: "append", rowsHash: OFFERED });
    expect(answer.receipt?.outcome).toBe("sent");
    expect(writes(pane)).toEqual([`block: ${NEW}`]);
    expect(pane.transcript.at(-1)).toBe(`› ${DRAFT} ${NEW}`);
  });
});
