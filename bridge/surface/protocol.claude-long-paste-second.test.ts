// Claude Code 2.1.332 in a 54 x 23 pane (live, 2026-11-27): the FIRST plain line of 376 characters is sent
// (protocol.claude-long-paste.test.ts), but the SECOND, on the same idle bot with an empty box, ended
// typed_not_submitted (modal_cue) 3 times in 3, left its text in the box, and every later send was refused.
// What Claude drew after the second paste is benign: the same scrolled box (`─── ↑ 2 more ───` over the tail of
// the text) as after the first, but now with the first turn still in view over it, the sent text echoed under
// its `❯` and wrapped into indented rows. The Surface reads the scrolled box past its prompt row only where
// the screen read WITHOUT that box shows no dialog cue, and that read took the echo for a pointed list
// (`pointer-row`): no box, modal unreadable. Captures: a throwaway Herdr pane w2D:p18, `herdr pane read`,
// the Herdr adapter's own bracketed paste (briefs EVIDENCE-claudep-long-paste-2.txt).

import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { profileFor } from "../../web/src/lib/surface/profile.ts";
import { agentOf, fixtureRows, idleFor, readScreen } from "../../web/src/test/surface-corpus.ts";
import { boxHolds, wholePaste } from "./protocol.ts";
import { DIALOG, FakePane, PROBE, rig, useScratchDir } from "./protocol.rig.ts";

useScratchDir();

const FIXTURES = fileURLToPath(new URL("fixtures/", import.meta.url));
/** Idle after the first long send: the first turn in view, the box empty. */
const FIRST_DONE = "claude--v2332-long-paste-first-done-herdr--w54.txt";
/** The second paste of the same text, before Enter: the first turn over the scrolled box. Stable for 2 s. */
const SECOND = "claude--v2332-long-paste-second-herdr--w54.txt";
const SENTENCE = "Por favor responde solo OK y para. Esta es una frase un poco larga para probar el ajuste de linea en un pane estrecho de Claude.";
/** The live receipts' text: one line, 376 characters, cut mid-sentence with its trailing space. */
const LONG = [SENTENCE, SENTENCE, SENTENCE].join(" ").slice(0, 376);
const WELCOME = ["", " ▐▛███▛█   Claude Code v2.1.332", "▝▜██████▀  Opus 5.5 with low effort · Claude API", " ▝▝   ▝▝   ~/claudep-stability", ""];

/** Words wrapped at `width` columns, the way Claude Code wraps a sent text in its transcript. */
function wrapWords(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    if (line.length > 0 && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else line = line.length === 0 ? word : `${line} ${word}`;
  }
  if (line.length > 0) out.push(line);
  return out;
}

/** A fake Claude pane and the texts it took as turns, in order. */
interface EchoingPane {
  readonly pane: FakePane;
  readonly sent: string[];
}

/**
 * Claude Code 2.1.332 at 54 x 23 with `"tui": "fullscreen"`: 52 columns of draft, six rows of box, and a sent
 * text echoed in the transcript as it really is (`❯ ` and its wrapped rows indented two columns, then the
 * answer and the turn's done row), not the rig's one-row `> text`.
 */
function narrowWithEchoes(): EchoingPane {
  const pane = new FakePane("claude");
  pane.boxWidth = 52;
  pane.boxCap = 6;
  pane.height = 23;
  pane.collapseOver = 800;
  pane.transcript = [...WELCOME];
  const sent: string[] = [];
  pane.afterInput = (p, what) => {
    if (!what.startsWith("keys:")) return;
    const last = p.transcript.at(-1);
    if (last === undefined || !last.startsWith("> ")) return;
    const text = last.slice(2);
    sent.push(text);
    const [head = "", ...rest] = wrapWords(text, 50);
    p.transcript = [...p.transcript.slice(0, -1), "", `❯ ${head}`, ...rest.map((row) => `  ${row}`), "", "● OK", "", "✻ Baked for 1s · done 11:16 PM"];
  };
  return { pane, sent };
}

function claude(pane: FakePane) {
  return rig({ pane, harness: "claude", version: "2.1.332", block: true, linePaste: false });
}

describe("Claude Code 2.1.332, the SECOND 376-character line in a 54 x 23 pane", () => {
  test("the real capture before it: idle, the first turn in view, an empty box", () => {
    const read = readScreen(fixtureRows(FIRST_DONE, FIXTURES), agentOf("claude"), idleFor("claude"));
    expect(read.surface).toMatchObject({ turn: "idle", modal: "none", composer: "empty" });
  });

  test("the real capture after its paste: the first turn's echo over the scrolled box is no dialog, and the box ends the text", () => {
    const read = readScreen(fixtureRows(SECOND, FIXTURES), agentOf("claude"), idleFor("claude"));
    const frame = read.frame;
    if (frame === null) throw new Error("the capture's box was not read");
    expect(frame.scrolled).toBe(true);
    expect(frame.label).toBe("↑ 2 more");
    expect(read.cues?.strength).toBe("none");
    expect(read.surface).toMatchObject({ turn: "idle", modal: "none", composer: "draft" });
    const match = profileFor("claude", "2.1.332", { log: () => undefined });
    const whole = wholePaste(match, [LONG], () => false);
    const collapse = match === null ? null : new RegExp(match.profile.collapse.pattern, "uy");
    expect(boxHolds(frame, "", [LONG], collapse, whole)).toBe("tail");
    expect(boxHolds(frame, "", [LONG.replace("pane estrecho ", "pane ancho ")], collapse, whole)).toBeNull();
  });

  test("three long sends in a row are each sent, with Enter, and leave no draft", async () => {
    const { pane, sent } = narrowWithEchoes();
    const { send } = claude(pane);
    for (let n = 1; n <= 3; n++) {
      const answer = await send(LONG);
      expect(answer.receipt).toMatchObject({ outcome: "sent", keys: ["probe", "Backspace", "Enter"] });
      expect(answer.receipt?.reason).toBeUndefined();
      expect(pane.box).toBe("");
      expect(sent).toHaveLength(n);
    }
    expect(sent).toEqual([LONG, LONG, LONG]);
    expect(pane.calls).toEqual([`type:${PROBE}`, `block:${LONG}`, `type:${PROBE}`, `block:${LONG}`, `type:${PROBE}`, `block:${LONG}`]);
    expect(pane.keysSeen.filter((key) => key === "Enter")).toHaveLength(3);
    // The screen the second and third pastes left before Enter was the capture's shape.
    expect(pane.render()).toContain("❯ Por favor responde solo OK y para.");
    // And a short send after them still finds an empty box.
    expect((await send("responde OK y para")).receipt).toMatchObject({ outcome: "sent" });
    expect(sent.at(-1)).toBe("responde OK y para");
  });

  test("a dialog that opens over the scrolled box after the paste still stops the send before Enter", async () => {
    const { pane } = narrowWithEchoes();
    const { send } = claude(pane);
    expect((await send(LONG)).receipt).toMatchObject({ outcome: "sent" });
    pane.afterInput = (p, what) => {
      if (what.startsWith("block:")) p.dialog = DIALOG;
    };
    const keys = pane.keysSeen.length;
    const answer = await send(LONG);
    expect(answer.receipt?.outcome).not.toBe("sent");
    expect(pane.keysSeen.slice(keys)).not.toContain("Enter");
  });

  test("a pointed list in the transcript over the scrolled box, its pointer on an option row, still reads as a dialog", () => {
    const lines = fixtureRows(SECOND, FIXTURES).map((row, i) => (i === 1 ? { segments: [{ text: "❯ 1. Por favor responde solo OK y para. Esta es una", style: {}, muted: false }] } : row));
    const read = readScreen(lines, agentOf("claude"), idleFor("claude"));
    expect(read.frame).toBeNull();
    expect(read.surface.modal).not.toBe("none");
  });
});
