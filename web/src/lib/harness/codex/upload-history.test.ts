import { describe, expect, it } from "vitest";
import type { StyledLine } from "@/lib/blocks";
import { liftCodexUploadEchoes } from "./upload-history";

const id = "term.abc.mwz50y8g-12345678.png";
const path = `/home/ubuntu/.local/state/collie/uploads/${id}`;
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
      path,
      `$ ls ${path}`,
    ]) {
      const blocks = [raw(text)];
      expect(liftCodexUploadEchoes(blocks)).toBe(blocks);
    }
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
