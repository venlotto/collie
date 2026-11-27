// Two ways a Codex 0.172.0 box stopped every send (live, 2026-11-27, codexp `w2D:p7`; lab the same day,
// captures/codex--v0172-{mention,shell}-*--w56.txt).
//
// 1. A draft that ends in a mention. `mira @READ` stayed in the box (its popup closed with Escape), and the
//    next send's draft probe typed `⌁` after it: Codex opened its file popup again (`READ⌁ no matches`), the
//    probe "changed more than the box", the screen showed the character twice, so it was never taken back.
//    The send ended `probe_failed` and the box kept `mira @READ⌁`. Any key in that token opens the popup,
//    the probe's Backspace too, so such a draft is never probed (`probe.popupTails`).
// 2. Shell mode. `!echo hola-bang` turned Codex's prompt glyph into `!` with `Shell mode` under the box; the
//    profile knew only `›`, so S1 found no box (`typed_not_submitted mismatch`), and from then on every send
//    was `refused unconfirmed` with no key until someone left shell mode by hand (Backspace on the empty
//    box; ctrl+u stays in it). The profile reads the `!` prompt now (`idle.shellMode`), a shell line is
//    confirmed with its lead read as the prompt glyph, and a send at an empty box in shell mode leaves the
//    mode first.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { muxAck, type MuxAck } from "../mux/types.ts";
import { FakePane, rig, OFFERED, useScratchDir, neverEscape } from "./protocol.rig.ts";

useScratchDir();

const VERSION = "0.172.0";
const NEW = "Responde solo OK-A3";
const MENTION = /(?:^|\s)[@$]\S*$/u;
const SHELL_ROW = `${" ".repeat(45)}\u001b[38;5;9mShell mode\u001b[39m`;

/**
 * Codex 0.172.0 at 56 columns as the lab drew it, with the two states above: a mention popup over the box
 * that any edit inside the box's last `@` or `$` token opens again (Escape closes it until the next key),
 * and shell mode, which `!` on an empty box enters, Backspace or Escape on the empty box leaves, and Enter
 * leaves after it ran the box as a shell command.
 */
class ShellCodex extends FakePane {
  shell = false;
  mentionOpen = false;
  /** The exit key does nothing: a shell mode Collie cannot leave. */
  stuckInShell = false;
  constructor() {
    super("codex");
    this.codexStatus = "  gpt-5 default · /tmp/pdlab/scratch";
    this.transcript = ["  >_ OpenAI Codex (v0.172.0)", "     /tmp/pdlab/scratch"];
    const keys = this.writeKeys;
    this.writeKeys = async (paneId: string, sent: readonly string[]): Promise<MuxAck> => {
      for (const key of sent) {
        if (this.shell && this.box === "" && (key === "Backspace" || key === "Escape")) {
          this.keysSeen.push(key);
          if (!this.stuckInShell) this.shell = false;
          this.mentionOpen = false;
          this.revision++;
          continue;
        }
        if (key === "Escape") {
          this.keysSeen.push(key);
          this.mentionOpen = false;
          this.revision++;
          continue;
        }
        if (key === "Enter" && this.shell && this.box !== "") {
          this.keysSeen.push(key);
          this.transcript.push(`• You ran ${this.box}`, `  └ ${this.box.replace(/^echo /u, "")}`);
          this.box = "";
          this.shell = false;
          this.revision++;
          continue;
        }
        await keys(paneId, [key]);
      }
      return muxAck();
    };
    this.afterInput = (pane, what) => {
      // `!` typed or pasted on an empty box is the mode switch, not a character: the rest stays in the box.
      const write = /^(?:type|paste|block):/u.test(what);
      if (write && !this.shell && this.box.startsWith("!") && this.box === what.slice(what.indexOf(":") + 1)) {
        this.shell = true;
        this.box = this.box.slice(1).trimStart();
      }
      if (what !== "keys:Escape") this.mentionOpen = !this.shell && MENTION.test(this.box);
      void pane;
    };
  }

  override render(): string {
    if (this.fixed !== null) return this.fixed;
    const token = /\S*$/u.exec(this.box)?.[0].slice(1) ?? "";
    const popup = this.mentionOpen ? ["  Mentions", "  Files, directories, plugins, skills and tasks", `  ${token}`, "  no matches", "  enter/tab insert · esc close · ↑/↓ select · ←/→ fil…"] : [];
    const prompt = this.shell
      ? `\u001b[1m\u001b[38;5;9m!\u001b[0m${this.box === "" ? "" : ` ${this.box}`}`
      : this.box === ""
        ? "\u001b[1m›\u001b[0m \u001b[2mAsk Codex to do anything\u001b[0m"
        : `› ${this.box}`;
    const under = this.shell ? [SHELL_ROW] : this.box === "" ? ["  ← for agents · ? for shortcuts"] : [];
    return [...this.transcript, ...popup, "", prompt, "", this.codexStatus, ...under].join("\n");
  }
}

function codex(box = "", shell = false) {
  const pane = new ShellCodex();
  pane.box = box;
  pane.shell = shell;
  const { send } = rig({ pane, harness: "codex", version: VERSION, block: true, linePaste: false });
  return { pane, send };
}

const capture = (name: string): string => readFileSync(join(import.meta.dirname, "captures", name), "utf8");
// eslint-disable-next-line no-control-regex
const plain = (text: string): string => text.replace(/\u001b\[[0-9;:?]*[ -/]*[@-~]/gu, "");
/** The rows from the prompt row down, as plain text with the blank rows left out. */
const boxAndBelow = (screen: string): string[] => {
  const rows = plain(screen).split("\n");
  const at = rows.findLastIndex((row) => /^[›!]/u.test(row));
  return rows.slice(at).filter((row) => row.trim() !== "").map((row) => row.trimEnd());
};
/** Every write of text, the probe's included. */
const writes = (pane: FakePane): string[] => pane.calls.filter((call) => /^(?:type|paste|block):/u.test(call));

describe("the captures (codex--v0172-{mention,shell}-*--w56.txt)", () => {
  test("the fake draws the mention draft and shell mode as Codex did", () => {
    const at = (box: string, shell: boolean): string => {
      const pane = new ShellCodex();
      pane.box = box;
      pane.shell = shell;
      return pane.render();
    };
    expect(boxAndBelow(at("mira @READ", false))).toEqual(boxAndBelow(capture("codex--v0172-mention-draft--w56.txt")));
    expect(boxAndBelow(at("", true))).toEqual(boxAndBelow(capture("codex--v0172-shell-mode-empty--w56.txt")));
    expect(boxAndBelow(at("echo hola-bang", true))).toEqual(boxAndBelow(capture("codex--v0172-shell-mode-typed--w56.txt")));
  });

  test("the bridge reads each capture: a draft, an empty box and a draft, all idle", async () => {
    const read = async (name: string) => {
      const pane = new ShellCodex();
      pane.fixed = capture(name);
      return (await rig({ pane, harness: "codex", version: VERSION, block: true }).send("", { mode: "prepare" })).surface;
    };
    expect(await read("codex--v0172-mention-draft--w56.txt")).toMatchObject({ turn: "idle", modal: "none", composer: "draft" });
    expect(await read("codex--v0172-shell-mode-empty--w56.txt")).toMatchObject({ turn: "idle", modal: "none", composer: "empty" });
    expect(await read("codex--v0172-shell-mode-typed--w56.txt")).toMatchObject({ turn: "idle", modal: "none", composer: "draft" });
  });

  test("the probe the old send typed after the mention left a popup that echoes it", () => {
    const screen = plain(capture("codex--v0172-mention-probe-popup--w56.txt"));
    expect(screen.split("⌁").length - 1).toBe(2);
    expect(screen).toContain("› mira @READ⌁");
  });
});

describe("a draft that ends in a mention gets no probe (2026-11-27)", () => {
  test("a send over `mira @READ` is refused draft_present with Replace and Cancel, and nothing reaches the box", async () => {
    const { pane, send } = codex("mira @READ");
    const answer = await send(NEW, { fromPhone: true });
    expect(answer.receipt).toMatchObject({ outcome: "refused", reason: "draft_present", keys: [] });
    expect(answer.offers).toEqual(["replace", "cancel"]);
    expect(answer.draftText).toBe("mira @READ");
    expect(writes(pane)).toEqual([]);
    expect(pane.keysSeen).toEqual([]);
    expect(pane.box).toBe("mira @READ");
    expect(pane.mentionOpen).toBe(false);
    expect(pane.render()).not.toContain("⌁");
  });

  test("a skill mention (`$`) and a box the old probe left (`mira @READ⌁`) are refused the same way", async () => {
    for (const box of ["usa $cre", "mira @READ⌁"]) {
      const { pane, send } = codex(box);
      const answer = await send(NEW, { fromPhone: true });
      expect(answer.receipt).toMatchObject({ outcome: "refused", reason: "draft_present", keys: [] });
      expect(writes(pane)).toEqual([]);
      expect(pane.box).toBe(box);
    }
  });

  test("a command over it is refused the same way, with no key", async () => {
    const { pane, send } = codex("mira @READ");
    const answer = await send("/status", { mode: "command" });
    expect(answer.receipt).toMatchObject({ outcome: "refused", reason: "draft_present", keys: [] });
    expect(answer.offers).toEqual(["replace", "cancel"]);
    expect(writes(pane)).toEqual([]);
  });

  test("a mention inside the draft, not at its end, is still proven by the probe and keeps Add", async () => {
    const { pane, send } = codex("mira @README.md y dime");
    const answer = await send(NEW, { fromPhone: true });
    expect(answer.receipt).toMatchObject({ outcome: "refused", reason: "draft_present", keys: ["probe", "Backspace"] });
    expect(answer.offers).toEqual(["append", "replace", "cancel"]);
    expect(pane.box).toBe("mira @README.md y dime");
  });

  test("Replace empties the box first, probes the empty box, and sends", async () => {
    const { pane, send } = codex("mira @READ");
    const answer = await send(NEW, { mode: "replace", rowsHash: OFFERED });
    expect(answer.receipt?.outcome).toBe("sent");
    const keys = answer.receipt?.keys ?? [];
    // The clear comes before the probe: no key ever lands after the mention.
    expect(keys.indexOf("probe")).toBeGreaterThan(keys.indexOf("Backspace"));
    expect(keys.slice(0, "mira @READ".length).every((key) => key === "Backspace")).toBe(true);
    expect(writes(pane)).toEqual(["block:⌁", `block:${NEW}`]);
    expect(pane.transcript.at(-1)).toBe(`› ${NEW}`);
    expect(pane.box).toBe("");
    neverEscape(pane);
  });

  test("Add to it is refused again with Replace and Cancel, before any key", async () => {
    const { pane, send } = codex("mira @READ");
    const answer = await send(NEW, { mode: "append", rowsHash: OFFERED });
    expect(answer.receipt).toMatchObject({ outcome: "refused", reason: "draft_present", keys: [] });
    expect(answer.offers).toEqual(["replace", "cancel"]);
    expect(writes(pane)).toEqual([]);
    expect(pane.box).toBe("mira @READ");
  });
});

describe("Codex's shell mode never leaves the composer dead (2026-11-27)", () => {
  test("`!echo hola-bang` as a command is sent: the box shows `! echo hola-bang`, Enter runs it", async () => {
    const { pane, send } = codex();
    const answer = await send("!echo hola-bang", { mode: "command" });
    expect(answer.receipt).toMatchObject({ outcome: "sent", keys: ["probe", "Backspace", "Enter"] });
    expect(pane.transcript).toContain("• You ran echo hola-bang");
    expect(pane.shell).toBe(false);
    expect(pane.box).toBe("");
  });

  test("a message at an empty box in shell mode leaves the mode with one Backspace, then is sent as a message", async () => {
    const { pane, send } = codex("", true);
    const answer = await send(NEW, { fromPhone: true });
    expect(answer.receipt?.outcome).toBe("sent");
    expect(answer.receipt?.keys[0]).toBe("Backspace");
    expect(pane.transcript.at(-1)).toBe(`› ${NEW}`);
    expect(pane.transcript.some((row) => row.startsWith("• You ran"))).toBe(false);
    expect(pane.shell).toBe(false);
  });

  test("a command and a shell line at an empty box in shell mode leave it first too", async () => {
    const status = codex("", true);
    expect((await status.send("/status", { mode: "command" })).receipt?.outcome).toBe("sent");
    expect(status.pane.transcript.at(-1)).toBe("› /status");
    const bang = codex("", true);
    const answer = await bang.send("!echo otra", { mode: "command" });
    expect(answer.receipt?.outcome).toBe("sent");
    expect(answer.receipt?.keys[0]).toBe("Backspace");
    expect(bang.pane.transcript).toContain("• You ran echo otra");
  });

  test("a shell mode that does not leave ends refused not_free (shell_mode), with no text typed", async () => {
    const { pane, send } = codex("", true);
    pane.stuckInShell = true;
    const answer = await send(NEW, { fromPhone: true });
    expect(answer.receipt).toMatchObject({ outcome: "refused", reason: "not_free" });
    expect(answer.cause).toBe("shell_mode");
    expect(answer.receipt?.detail).toContain("shell mode");
    expect(answer.offers).toEqual(["keys"]);
    expect(writes(pane)).toEqual([]);
    expect(pane.keysSeen).not.toContain("Enter");
    expect(pane.keysSeen).not.toContain("Tab");
  });

  test("a shell line left in the box is a draft: a send is refused with Replace and Cancel, Add too", async () => {
    const { pane, send } = codex("echo hola-bang", true);
    const answer = await send(NEW, { fromPhone: true });
    expect(answer.receipt).toMatchObject({ outcome: "refused", reason: "draft_present" });
    expect(answer.offers).toEqual(["replace", "cancel"]);
    const add = await send(NEW, { mode: "append", rowsHash: OFFERED });
    expect(add.receipt).toMatchObject({ outcome: "refused", reason: "draft_present" });
    expect(pane.box).toBe("echo hola-bang");
    expect(pane.keysSeen).not.toContain("Enter");
    expect(pane.keysSeen).not.toContain("Tab");
  });

  test("Replace over a shell line empties it, leaves shell mode and sends the message", async () => {
    const { pane, send } = codex("echo hola-bang", true);
    const answer = await send(NEW, { mode: "replace", rowsHash: OFFERED });
    expect(answer.receipt?.outcome).toBe("sent");
    expect(pane.transcript.at(-1)).toBe(`› ${NEW}`);
    expect(pane.transcript.some((row) => row.startsWith("• You ran"))).toBe(false);
    expect(pane.shell).toBe(false);
    neverEscape(pane);
  });

  test("a message never goes with a submit key while the box reads shell mode", async () => {
    // A box that slips into shell mode as the text lands (a `!` the person typed meanwhile).
    const { pane, send } = codex();
    const typed = pane.afterInput!;
    pane.afterInput = (p, what) => {
      typed(p, what);
      if (what === `block:${NEW}`) pane.shell = true;
    };
    const answer = await send(NEW, { fromPhone: true });
    expect(answer.receipt?.outcome).toBe("typed_not_submitted");
    expect(pane.keysSeen).not.toContain("Enter");
    expect(pane.keysSeen).not.toContain("Tab");
  });
});
