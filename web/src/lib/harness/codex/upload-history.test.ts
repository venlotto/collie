import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAnsi } from "@/lib/ansi";
import { lineText, splitLines, type Block, type StyledLine } from "@/lib/blocks";
import { buildBlocks } from "@/lib/harness";
import { liftCodexUploadEchoes } from "./upload-history";

const id = "term.abc.mwz50y8g-12345678.png";
const path = `/home/ubuntu/.local/state/collie/uploads/${id}`;
const liveId = "term.8e157ec6c195a5165416515fd82dacb5e24cfaf307dfdc58008fd9fb0082dde2.mwzcmgas-ff7603b9.png";
function raw(text: string) {
  return { kind: "raw" as const,
    lines: text.split("\n").map((row) => ({ segments: [{ text: row, style: {}, muted: false }] } satisfies StyledLine)) };
}

describe("liftCodexUploadEchoes", () => {
  it("lifts a whole upload echo and leaves the surrounding terminal intact", () => {
    const parts = liftCodexUploadEchoes([raw(`before\n› ${path} COL-21: responde OK y para.\n\n• OK`)]);
    expect(parts).toEqual([
      raw("before"),
      { kind: "user-upload", text: `/uploads/${id} COL-21: responde OK y para.` },
      raw("\n• OK"),
    ]);
  });

  it("joins the input well's soft wraps without breaking the minted id", () => {
    const wrapped = `${path.slice(0, 51)}\n${path.slice(51, 95)}\n${path.slice(95)} COL-21:\nresponde OK y para.`;
    expect(liftCodexUploadEchoes([raw(`› ${wrapped}`)])).toEqual([
      { kind: "user-upload", text: `/uploads/${id} COL-21: responde OK y para.` },
    ]);
  });

  it("does not claim prompts, options, ordinary paths or unmarked uploads", () => {
    for (const text of [
      "› 1. /home/ubuntu/project/photo.png",
      `› /home/ubuntu/project/uploads/not-minted.png`,
      "› /home/ubuntu/project/uploads/   \n  not-minted.png  \n  sigue siendo prosa",
      path,
      `$ ls ${path}`,
    ]) {
      const blocks = [raw(text)];
      expect(liftCodexUploadEchoes(blocks)).toBe(blocks);
    }
  });

  it("lifts the real padded input-well capture through the terminal pipeline", () => {
    const capture = readFileSync(new URL("../../../fixtures/panes/codex--upload-history-padded-well.txt", import.meta.url), "utf8");
    const blocks = buildBlocks(splitLines(parseAnsi(capture)), { agent: "codex" });
    const rawBlocks = blocks.filter((block): block is Extract<Block, { kind: "raw" }> => block.kind === "raw");
    const parts = liftCodexUploadEchoes(rawBlocks);

    expect(parts.filter((part) => part.kind === "user-upload")).toEqual([
      { kind: "user-upload", text: `/uploads/${liveId} COL-21: responde OK y para.` },
    ]);
    const rawText = parts.flatMap((part) => part.kind === "raw" ? part.lines.map(lineText) : []).join("\n");
    expect(rawText).toContain("• OK");
    expect(rawText).toContain("⚠ weekly limit: 18% left");
    expect(rawText).not.toContain("/home/ubuntu/.local/state/collie/uploads/");

    const composer = [raw("› Ask Codex to do anything")];
    expect(liftCodexUploadEchoes(composer)).toBe(composer);
  });

  it("trims padding and continuation indentation in a synthetic wrapped id", () => {
    const wrapped = [
      "› /home/ubuntu/.local/state/collie/uploads/           ",
      "  term.8e157ec6c195a5165416515fd82dacb5e24cfaf307dfdc ",
      "  58008fd9fb0082dde2.mwzcmgas-ff7603b9.png COL-21:    ",
      "  responde OK y para.                                 ",
    ].join("\n");
    expect(liftCodexUploadEchoes([raw(wrapped)])).toEqual([
      { kind: "user-upload", text: `/uploads/${liveId} COL-21: responde OK y para.` },
    ]);
  });

  it("keeps an unmarked reply out of the following upload turn", () => {
    const parts = liftCodexUploadEchoes([raw(`• previous reply\n\n› ${path} caption\n› siguiente turno`)]);
    expect(parts).toEqual([
      raw("• previous reply\n"),
      { kind: "user-upload", text: `/uploads/${id} caption` },
      raw("› siguiente turno"),
    ]);
  });
});
