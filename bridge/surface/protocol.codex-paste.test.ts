// The Send Protocol on Codex 0.172.0 sends every message as ONE bracketed paste (live report of
// 2026-11-27, codexp on a narrow iPhone pane). Typed as keys, a message that opened with `?` lost the
// `?` to Codex's shortcuts overlay, so the box never held the typed text and the send ended
// typed_not_submitted(mismatch) with a 376-character draft left behind; a multi-line message typed
// as fast keys drew blank rows while Codex settled the burst, read twice as a dialog at the box, and
// ended typed_not_submitted(modal_cue). The lab on 0.172.0 (captures/codex--v0172-*--w56.txt):
// a bracketed paste of 1000 characters or fewer lands literally, `?` and line breaks included, and a
// longer one folds to `[Pasted Content N chars]`, N counting the line breaks. The fake below draws
// those measured behaviours: Codex's word wrap at 54 columns, the eaten `?`, and the fold.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { profileFor, type Profile } from "../../web/src/lib/surface/profile.ts";
import { FakePane, rig, useScratchDir } from "./protocol.rig.ts";
import { boxMatches, wholePaste } from "./protocol.ts";

useScratchDir();

const VERSION = "0.172.0";
const BOX_WIDTH = 54;
const FOLD_OVER = 1000;

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

/** A Codex 0.172.0 pane at 56 columns, as the lab measured it. */
class Codex172 extends FakePane {
  overlay = false;
  constructor() {
    super("codex");
    this.codexStatus = "  gpt-5 default · /tmp/cx-scratch";
    this.collapseOver = Number.MAX_SAFE_INTEGER;
  }

  override render(): string {
    const rows = [...this.transcript, "", ""];
    if (this.overlay) rows.push("  Shortcuts", "  ? / esc close");
    if (this.box === "") rows.push("\u001b[1m›\u001b[0m \u001b[2mAsk Codex to do anything\u001b[0m");
    else this.box.split("\n").forEach((line, li) => codexWrap(line, BOX_WIDTH).forEach((chunk, ci) => rows.push(`${li === 0 && ci === 0 ? "›" : " "} ${chunk}`)));
    rows.push("", this.codexStatus);
    if (this.box === "") rows.push(this.overlay ? "  ? / esc close" : "  ← for agents · ? for shortcuts");
    return rows.join("\n");
  }
}

function codexPane(): Codex172 {
  const pane = new Codex172();
  // Typed keys: a `?` on an empty box opens the overlay and is not typed; the next key closes it.
  pane.typeText = (_paneId, text) => {
    pane.calls.push(`type:${text}`);
    let rest = text;
    if (pane.box === "" && rest.startsWith("?")) {
      rest = rest.slice(1);
      pane.overlay = rest.length === 0;
    } else {
      pane.overlay = false;
    }
    pane.box += rest;
    pane.revision++;
    return Promise.resolve({ ok: true, value: undefined });
  };
  // One bracketed paste: literal up to 1000 characters, else the fold that counts them.
  pane.pasteBlock = (_paneId, text) => {
    pane.calls.push(`block:${text}`);
    pane.overlay = false;
    pane.box += [...text].length > FOLD_OVER ? `[Pasted Content ${String([...text].length)} chars]` : text;
    pane.revision++;
    return Promise.resolve({ ok: true, value: undefined });
  };
  return pane;
}

/** The submit leaves the box: the fake's Tab and Enter put the box in the transcript; a fold is expanded, as Codex does. */
const sentRow = (pane: FakePane): string | undefined => pane.transcript.at(-1);

/** The Codex profile as it was before this fix: no whole paste. */
const typedKeys = (profile: Profile): Profile => ({ ...profile, paste: { bracketed: true } });

const LONG = `?${"Explica en una frase por que el cielo es azul. ".repeat(9).slice(0, 376).trimEnd()}`;
const PARAGRAPH = "Revisa por favor el modulo de envio y dime que falla cuando el texto es largo. ";
const MULTI = [PARAGRAPH.repeat(2), PARAGRAPH, PARAGRAPH.repeat(2), "", PARAGRAPH.repeat(2)].join("\n").trimEnd();
const FOLDED = Array.from({ length: 8 }, (_, i) => `linea ${String(i)} con algo de texto para llenar la caja bien `.repeat(3).trimEnd()).join("\n");

describe("the Codex profile pastes every message (2026-11-27)", () => {
  test("the profile sets one paste for every length", async () => {
    const { loadProfiles } = await import("../../web/src/lib/surface/profile.ts");
    expect(loadProfiles().get("codex")?.paste).toMatchObject({ bracketed: true, block: true, blockMinChars: 0 });
  });

  test("red before the fix: typed as keys, a leading ? is lost and the long draft is left in the box (live: 376 characters, mismatch)", async () => {
    const pane = codexPane();
    // Herdr's text call writes raw bytes (no per-line paste): the old profile typed the text as keys there.
    const answer = await rig({ pane, harness: "codex", version: VERSION, paste: false, edit: typedKeys }).send(LONG);
    expect(answer.receipt).toMatchObject({ outcome: "typed_not_submitted", reason: "mismatch" });
    expect(pane.box).toBe(LONG.slice(1));
  });

  test("a 376-character message that opens with ? is pasted whole and sent", async () => {
    const pane = codexPane();
    const answer = await rig({ pane, harness: "codex", version: VERSION, block: true }).send(LONG);
    expect(answer.receipt?.outcome).toBe("sent");
    // The message is one paste (the probe before it is zone B's to shape, so only the last call is pinned).
    expect(pane.calls.at(-1)).toBe(`block:${LONG}`);
    expect(pane.calls.filter((call) => call.includes("Explica"))).toEqual([`block:${LONG}`]);
    expect(sentRow(pane)).toBe(`› ${LONG}`);
    expect(pane.box).toBe("");
  });

  test("? alone is pasted and sent, never opening the shortcuts overlay", async () => {
    const pane = codexPane();
    const answer = await rig({ pane, harness: "codex", version: VERSION, block: true }).send("?");
    expect(answer.receipt?.outcome).toBe("sent");
    expect(pane.overlay).toBe(false);
    expect(sentRow(pane)).toBe("› ?");
  });

  test("a multi-line message goes as one paste, no ctrl+j between its lines", async () => {
    const pane = codexPane();
    const answer = await rig({ pane, harness: "codex", version: VERSION, block: true }).send(MULTI);
    expect(answer.receipt?.outcome).toBe("sent");
    expect(pane.keysSeen).not.toContain("ctrl+j");
    expect(pane.calls.at(-1)).toBe(`block:${MULTI}`);
  });

  test("short texts with @, ! inside and ? at the end are pasted and sent as typed", async () => {
    for (const text of ["primera linea\nsegunda linea con @README y ? al final", "hola ?", "di hola!", "a/b"]) {
      const pane = codexPane();
      const answer = await rig({ pane, harness: "codex", version: VERSION, block: true }).send(text);
      expect(answer.receipt?.outcome, text).toBe("sent");
      expect(sentRow(pane), text).toBe(`› ${text.replace(/\n/gu, " ")}`);
    }
  });

  test("over 1000 characters Codex folds the paste; the fold that counts exactly the text is the text, and the send goes", async () => {
    const pane = codexPane();
    expect(FOLDED.length).toBeGreaterThan(FOLD_OVER);
    const answer = await rig({ pane, harness: "codex", version: VERSION, block: true }).send(FOLDED);
    expect(answer.receipt?.outcome).toBe("sent");
    expect(sentRow(pane)).toBe(`› [Pasted Content ${String(FOLDED.length)} chars]`);
  });

  test("a fold that counts another length is not the text: no submit key", async () => {
    const pane = codexPane();
    pane.pasteBlock = (_paneId, text) => {
      pane.calls.push(`block:${text}`);
      pane.box += `[Pasted Content ${String(text.length + 1)} chars]`;
      pane.revision++;
      return Promise.resolve({ ok: true, value: undefined });
    };
    const answer = await rig({ pane, harness: "codex", version: VERSION, block: true }).send(FOLDED);
    expect(answer.receipt).toMatchObject({ outcome: "typed_not_submitted", reason: "mismatch" });
    expect(pane.keysSeen.filter((key) => key === "Tab" || key === "Enter")).toEqual([]);
  });

  test("a slash command keeps its typed write, so Codex reads the lead", async () => {
    const pane = codexPane();
    const answer = await rig({ pane, harness: "codex", version: VERSION, block: true }).send("/status", { mode: "command" });
    expect(answer.receipt?.outcome).toBe("sent");
    expect(pane.calls.some((call) => call.startsWith("block:"))).toBe(false);
  });

  test("one paste for any text but a reserved lead or nothing", () => {
    // wholePaste is asked only where the multiplexer has pasteBlock (Herdr); tmux keeps its paste per line.
    const match = profileFor("codex", VERSION, { log: () => undefined });
    expect(wholePaste(match, ["hola"])).not.toBeNull();
    expect(wholePaste(match, ["/status"])).toBeNull();
    expect(wholePaste(match, [""])).toBeNull();
  });
});

describe("the captured screens (codex--v0172-*--w56.txt)", () => {
  const capture = (name: string): string => readFileSync(join(import.meta.dirname, "captures", name), "utf8");
  // eslint-disable-next-line no-control-regex
  const plain = (text: string): string => text.replace(/\u001b\[[0-9;:?]*[ -/]*[@-~]/gu, "");
  const box = (text: string): string => {
    const rows = plain(text).split("\n");
    const top = rows.findIndex((row) => row.startsWith("› "));
    const bottom = rows.findIndex((row, i) => i > top && row.trim() === "");
    return rows.slice(top, bottom).map((row) => row.slice(2)).join("\n");
  };
  const collapse = new RegExp("\\[Pasted Content (?<chars>\\d+) chars\\]", "uy");

  test("the typed box lost the ? and so is not the text, wrapping aside", () => {
    const shown = box(capture("codex--v0172-typed-question-lead--w56.txt"));
    expect(boxMatches(shown, "", [LONG], collapse)).toBe(false);
    expect(boxMatches(shown, "", [LONG.slice(1)], collapse)).toBe(true);
  });

  test("the folded paste matches its own text by the count, and no other", () => {
    const shown = box(capture("codex--v0172-pasted-content--w56.txt"));
    const whole = { images: 0, image: null, lines: FOLDED.split("\n"), literal: FOLDED.split("\n") };
    // The lab's paste kept the trailing space of each line: 1231 characters.
    const lab = Array.from({ length: 8 }, (_, i) => `linea ${String(i)} con algo de texto para llenar la caja bien `.repeat(3)).join("\n");
    expect(boxMatches(shown, "", lab.split("\n"), collapse, { ...whole, lines: lab.split("\n"), literal: lab.split("\n") })).toBe(true);
    expect(boxMatches(shown, "", FOLDED.split("\n"), collapse, whole)).toBe(false);
  });
});
