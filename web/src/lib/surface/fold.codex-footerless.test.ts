import { describe, expect, it } from "vitest";

import { fixtureRows, readScreen, rowsOf } from "../../test/surface-corpus";
import { inputFrameOf } from "./fold";
import { requireProfile } from "./profile";

// Codex 0.172.0 in a 23-row pane draws a multi-paragraph draft at the editor's full height with no footer
// under it (fixtures codex--v0172-footerless-draft--herdr.txt and its plain read, 2026-11-28): the box
// is read where the profile says its editor fills the pane (`idle.frame.scroll.wholeClips`). A dialog
// drawn to the screen's end under a transcript echo of a sent prompt walks the same way, so these
// screens pin that none of them reads as that box.

const CODEX = requireProfile("codex").idle;
const HEAD = ["", "  >_ OpenAI Codex (v0.172.0)", "     ~/repos", "  permissions: YOLO mode", "", "› Usa la herramienta y pregunta algo antes de seguir.", ""];

/** A 23-row screen: Codex's header, a sent prompt's echo, then `body` padded with blank rows to the end. */
function under(body: readonly string[]): string {
  const rows = [...HEAD, ...body];
  while (rows.length < 23) rows.push("");
  return rows.slice(0, 23).join("\n");
}

// Each body is the text of a real dialog fixture's rows, the transcript above it left out.
const DIALOGS = {
  // codex--ask-fruit.txt: the question card, its pointer indented inside the card.
  question: [
    "  Question 1/1 (1 unanswered)",
    "  Pick a fruit?",
    "",
    "  › 1. Apple (Recommended)  Choose a crisp apple.",
    "    2. Pear                 Choose a soft pear.",
    "    3. None of the above    Optionally, add notes.",
    "",
    "  tab to add notes | enter to submit answer | esc to interrupt",
  ],
  // The same card cut under its options: no key row at all.
  "question cut": [
    "  Question 1/1 (1 unanswered)",
    "  Pick a fruit?",
    "",
    "  › 1. Apple (Recommended)  Choose a crisp apple.",
    "    2. Pear                 Choose a soft pear.",
    "    3. None of the above    Optionally, add notes.",
  ],
  // codex--v0172-async-other-focused-23rows--w52.txt: the async question panel.
  "async question": ["  1 of 2", "  Pet?", "", "    1. Cat", "    2. Dog", "  › 3. Other", "", "  enter submit   ^] skip   shift+→ main prompt", "  shift+← next question"],
  // codex--v0156-approval-exec-wrapped-50.txt
  approval: [
    "  Would you like to run the following command?",
    "",
    "  Reason: May I run `touch",
    "  narrow-approval-test.txt` to create the",
    "  requested file?",
    "",
    "  $ touch narrow-approval-test.txt",
    "",
    "› 1. Yes, proceed (y)",
    "  2. Yes, and don't ask again for commands that",
    "     start with `touch narrow-approval-test.txt`",
    "  3. No, and tell Codex what to do differently",
    "",
    "  Press enter to confirm or esc to cancel",
  ],
  // codex--v0172-startup-trust--w52.txt
  trust: [
    "  Trust this folder? Codex can read, edit, and run",
    "  files here, subject to your permission settings.",
    "",
    "› 1. Trust and continue",
    "  2. Back to Agent Command Center",
    "",
    "  enter continue · esc back",
  ],
  // codex--v0172-startup-update--w52.txt
  update: [
    "  Update available · 0.172.0 → 0.173.0",
    "  Release notes:",
    "",
    "› 1. Update now (runs `npm install -g @openai/",
    "     codex`)",
    "  2. Skip",
    "  3. Skip until next version",
    "",
    "  enter continue · esc skip",
  ],
  // codex--v0172-surface-model-dialog--w52.txt
  "model picker": [
    "  Select Model and Effort",
    "",
    "  4. GPT-6.1-Sol            Previous generation",
    "                            model for coding and",
    "› 5. GPT-6-Astra (current)  Previous generation",
    "                            model for complex coding",
    "  6. GPT-6-Sol              Legacy model for coding",
    "↓",
    "  enter select · esc back",
  ],
} satisfies Record<string, readonly string[]>;

describe("Codex's footerless whole draft (idle.frame.scroll.wholeClips)", () => {
  for (const name of ["codex--v0172-footerless-draft--herdr.txt", "codex--v0172-footerless-draft-plain--herdr.txt"]) {
    it(`${name} reads idle, no dialog, a whole draft`, () => {
      const rows = fixtureRows(name);
      expect(readScreen(rows, "codex", CODEX).surface).toEqual({ revision: 1, turn: "idle", modal: "none", composer: "draft" });
      const frame = inputFrameOf(rows, CODEX);
      expect(frame?.bottomClipped).toBe(true);
      expect(frame?.scrolled).toBeUndefined();
      expect(frame?.interior.text.startsWith("Hola, necesito que revises esto con calma.")).toBe(true);
    });
  }

  for (const [name, body] of Object.entries(DIALOGS)) {
    it(`the ${name} under a sent prompt's echo is never that box`, () => {
      for (const lift of [true, false]) {
        const rows = rowsOf(under(body));
        const surface = readScreen(rows, "codex", CODEX, { lift }).surface;
        expect(surface.modal, `${name}, lift ${String(lift)}`).not.toBe("none");
        expect(surface.composer, `${name}, lift ${String(lift)}`).not.toBe("draft");
      }
    });
  }

  it("a short box cut at the screen's end is still no box: a torn read, not an editor at its full height", () => {
    const rows = rowsOf([...HEAD, ...Array.from({ length: 12 }, () => "  • earlier answer"), "", "› Hola", "  mundo"].join("\n"));
    expect(inputFrameOf(rows, CODEX)).toBeNull();
  });

  it("a footer row the profile names, inside the rows, keeps the screen unread", () => {
    const capture = fixtureRows("codex--v0172-footerless-draft-plain--herdr.txt").map((row) => row.segments.map((run) => run.text).join(""));
    for (const hint of ["  ? for shortcuts", "  ← for agents  ⚠ 3 warnings · f2 to view", "  tab to queue message"]) {
      const rows = rowsOf([...capture.slice(0, -1), hint, ""].join("\n"));
      expect(inputFrameOf(rows, CODEX), hint).toBeNull();
    }
  });

  it("the profile's flag alone turns the read on: without it the capture reads no-match, as before", () => {
    const scroll = CODEX.frame.scroll!;
    const off = { ...CODEX, frame: { ...CODEX.frame, scroll: { keeps: scroll.keeps, rows: scroll.rows, promptMarker: scroll.promptMarker! } } };
    expect(readScreen(fixtureRows("codex--v0172-footerless-draft--herdr.txt"), "codex", off).surface.reason).toBe("no-match");
  });
});
