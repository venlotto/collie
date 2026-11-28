import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureRows, idleFor, loadLabels, readScreen, rowsOf } from "../../web/src/test/surface-corpus";
import { isFree } from "../../web/src/lib/surface/surface";
import { FakePane, OFFERED, rig, useScratchDir } from "./protocol.rig";

useScratchDir();

const MESSAGE = "Reply only OK. Do not use tools.\n\nFirst paragraph.\n\n\nLast paragraph.";
const WARNING = "                            ⚠ 3 warnings · f2 to view";
function paneWithWarnings(status = "") {
  const pane = new FakePane("codex");
  pane.codexStatus = status;
  pane.blockLiteralLines = 100;
  pane.codexHint = WARNING;
  return pane;
}

describe("Codex first-turn and multiline drafts", () => {
  for (const status of ["", "  GPT-6-Astra high · ~/repos"]) {
    test(`submits all paragraphs once with ${status ? "the model status" : "only the warning footer"}`, async () => {
      const pane = paneWithWarnings(status);
      const answer = await rig({ pane, harness: "codex", version: "0.172.0", block: true, linePaste: false }).send(MESSAGE);
      expect(answer.receipt?.outcome).toBe("sent");
      expect(pane.transcript.filter(row => row === `› ${MESSAGE.replace(/\n/gu, " ")}`)).toHaveLength(1);
      expect(pane.box).toBe("");
      expect(pane.keysSeen.filter(key => key === "Enter" || key === "Tab")).toHaveLength(1);
      expect(pane.render()).not.toContain("⌁");
    });
  }

  test("a stranded draft is preserved and Submit submits the existing text without another paste", async () => {
    const pane = paneWithWarnings();
    pane.box = MESSAGE;
    const { send } = rig({ pane, harness: "codex", version: "0.172.0" });
    const refused = await send(MESSAGE);
    expect(refused.receipt).toMatchObject({ outcome: "refused", reason: "draft_present" });
    expect(pane.box).toBe(MESSAGE);
    const submitted = await send(MESSAGE, { mode: "submit", rowsHash: OFFERED });
    expect(submitted.receipt?.outcome).toBe("sent");
    expect(pane.transcript.filter(row => row === `› ${MESSAGE.replace(/\n/gu, " ")}`)).toHaveLength(1);
    expect(pane.calls.filter(call => /^(?:type|paste|block):/u.test(call)).every(call => call.endsWith(":⌁"))).toBe(true);
    expect(pane.render()).not.toContain("⌁");
  });

  test("a real approval opening after the paste still receives no submit key", async () => {
    const pane = paneWithWarnings();
    pane.afterInput = (current, what) => {
      if (what.startsWith("block:") && what.includes("First paragraph")) {
        current.dialog = ["Allow this command?", "", "› 1. Yes", "  2. No", "", WARNING];
      }
    };
    const answer = await rig({ pane, harness: "codex", version: "0.172.0", block: true, linePaste: false }).send(MESSAGE);
    expect(answer.receipt?.outcome).toBe("typed_not_submitted");
    expect(pane.keysSeen.filter(key => key === "Enter" || key === "Tab")).toEqual([]);
  });

  test("the captured first-turn draft and the native multiline editor both read as drafts", () => {
    for (const file of ["codex--v0172-first-draft-paragraphs.txt", "codex--v0172-native-paragraphs--w56.txt"]) {
      const text = readFileSync(join(import.meta.dirname, "captures", file), "utf8");
      expect(readScreen(rowsOf(text), "codex", idleFor("codex")).surface).toMatchObject({ turn: "idle", modal: "none", composer: "draft" });
    }
  });

  test("every captured dialog and screen still fails closed with the Codex profile", () => {
    const free: string[] = [];
    const idle = idleFor("codex");
    for (const [name, label] of Object.entries(loadLabels().fixtures)) {
      if (label.state !== "dialog" && label.state !== "screen") continue;
      if (isFree(readScreen(fixtureRows(name), label.harness, idle).surface)) free.push(name);
    }
    expect(free).toEqual([]);
  }, 60_000);
});
