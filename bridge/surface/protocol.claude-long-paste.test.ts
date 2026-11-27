// Claude Code 2.1.332 in a 54 x 23 pane (live, 2026-11-27): one plain line of 376 characters is ONE
// bracketed paste (every plain Claude message is, so a leading `?` stays literal), lands literally, and
// wraps past the box's six-row cap, so the box scrolls under `─── ↑ 2 more ───` and its `❯` row leaves
// the top. The send must compare the rows in view with the END of the text and press Enter, as it does for
// a typed text. It ended typed_not_submitted (mismatch) with the text left in the box, and every later
// send, Replace included, was refused draft_present over it.

import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { profileFor } from "../../web/src/lib/surface/profile.ts";
import { agentOf, fixtureRows, idleFor, readScreen } from "../../web/src/test/surface-corpus.ts";
import { boxHolds, wholePaste } from "./protocol.ts";
import { FakePane, OFFERED, PROBE, rig, useScratchDir } from "./protocol.rig.ts";

useScratchDir();

const FIXTURES = fileURLToPath(new URL("fixtures/", import.meta.url));
const CAPTURE = "claude--v2332-long-paste-scrolled--w54.txt";
const SENTENCE = "Por favor responde solo OK y para. Esta es una frase un poco larga para probar el ajuste de linea en un pane estrecho de Claude.";
/** The live receipts' text: one line, 376 characters, cut mid-sentence with its trailing space. */
const LONG = [SENTENCE, SENTENCE, SENTENCE].join(" ").slice(0, 376);

/** Claude Code 2.1.332 at 54 x 23: 52 columns of draft, six rows of box before it scrolls, real paste thresholds. */
function narrow(): FakePane {
  const pane = new FakePane("claude");
  pane.boxWidth = 52;
  pane.boxCap = 6;
  pane.height = 23;
  // Claude folds a one-line paste past 800 characters (ADR 0010); 376 land literally.
  pane.collapseOver = 800;
  return pane;
}

function claude(pane: FakePane = narrow()) {
  return rig({ pane, harness: "claude", version: "2.1.332", block: true, linePaste: false });
}

describe("Claude Code 2.1.332, a 376-character line in a 54 x 23 pane", () => {
  test("the live text is the receipts' one line of 376 characters", () => {
    expect(LONG).toHaveLength(376);
    expect(LONG).not.toContain("\n");
  });

  test("the real capture: the paste landed literally, the box scrolled, and its rows in view are the end of the text", () => {
    const read = readScreen(fixtureRows(CAPTURE, FIXTURES), agentOf("claude"), idleFor("claude"));
    const frame = read.frame;
    if (frame === null) throw new Error("the capture's box was not read");
    expect(frame.scrolled).toBe(true);
    expect(frame.label).toBe("↑ 2 more");
    expect(read.surface).toMatchObject({ turn: "idle", modal: "none", composer: "draft" });
    const match = profileFor("claude", "2.1.332", { log: () => undefined });
    const whole = wholePaste(match, [LONG], () => false);
    expect(whole).toMatchObject({ images: 0, lines: [LONG] });
    const collapse = match === null ? null : new RegExp(match.profile.collapse.pattern, "uy");
    expect(boxHolds(frame, "", [LONG], collapse, whole)).toBe("tail");
    // Still as strict as a box that fits: another ending, or a text the box does not end, is no match.
    expect(boxHolds(frame, "", [LONG.replace("pane estrecho ", "pane ancho ")], collapse, whole)).toBeNull();
    expect(boxHolds(frame, "", [`${LONG} y algo mas`], collapse, whole)).toBeNull();
  });

  test("the send pastes it whole, reads the scrolled box by its tail, and presses Enter", async () => {
    const { pane, send } = claude();
    const answer = await send(LONG);
    expect(answer.receipt).toMatchObject({ outcome: "sent", keys: ["probe", "Backspace", "Enter"] });
    expect(pane.calls).toEqual([`type:${PROBE}`, `block:${LONG}`]);
    expect(pane.transcript.at(-1)).toBe(`> ${LONG}`);
    expect(pane.box).toBe("");
    // The next send finds an empty box: nothing is left to refuse it as draft_present.
    expect((await send("responde OK y para")).receipt).toMatchObject({ outcome: "sent" });
    expect(pane.transcript.at(-1)).toBe("> responde OK y para");
  });

  test("Replace of a draft with the long text empties it, pastes the text, and presses Enter", async () => {
    const { pane, send } = claude();
    pane.box = "un borrador viejo";
    expect((await send("hola")).receipt).toMatchObject({ outcome: "refused", reason: "draft_present" });
    const answer = await send(LONG, { mode: "replace", rowsHash: OFFERED });
    expect(answer.receipt).toMatchObject({ outcome: "sent" });
    expect(answer.receipt?.keys.at(-1)).toBe("Enter");
    expect(pane.transcript.at(-1)).toBe(`> ${LONG}`);
    expect(pane.box).toBe("");
    expect((await send("responde OK y para")).receipt).toMatchObject({ outcome: "sent" });
  });

  test("a short multi-line message that lands literally and outgrows the box is sent the same way", async () => {
    const { pane, send } = claude();
    // Three lines land literally (blockLiteralLines); at 52 columns they take eight rows, two past the cap.
    const text = [SENTENCE, SENTENCE, "Tercera."].join("\n");
    const answer = await send(text);
    expect(answer.receipt).toMatchObject({ outcome: "sent" });
    expect(pane.calls.at(-1)).toBe(`block:${text}`);
    expect(pane.box).toBe("");
  });

  test("a paste that lands as something other than the text's end still stops before Enter", async () => {
    const pane = narrow();
    // The box keeps the paste but loses its last character: the rows in view no longer end the text.
    pane.afterInput = (p, what) => {
      if (what.startsWith("block:")) p.box = p.box.slice(0, -2);
    };
    const { send } = claude(pane);
    const answer = await send(LONG);
    expect(answer.receipt).toMatchObject({ outcome: "typed_not_submitted", reason: "mismatch" });
    expect(pane.keysSeen).not.toContain("Enter");
  });

  test("a leading ? is still one literal paste, with a long text after it", async () => {
    const pane = narrow();
    pane.afterInput = (p, what) => {
      if (what === "type:?") p.dialog = ["  ! for shell mode      esc esc to clear input"];
    };
    const { send } = claude(pane);
    const text = `?${LONG}`;
    expect((await send(text)).receipt).toMatchObject({ outcome: "sent" });
    expect(pane.dialog).toBeNull();
    expect(pane.calls).toEqual([`type:${PROBE}`, `block:${text}`]);
  });
});
