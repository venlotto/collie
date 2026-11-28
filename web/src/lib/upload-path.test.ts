import { describe, expect, it } from "vitest";
import { isUploadImagePath, pastePieces } from "./upload-path";

const terminal = `term.${"a".repeat(64)}.mx0g6qb2-475a0f8a`;

describe("saved upload paths", () => {
  it("recognises both pane-owned and terminal-owned images", () => {
    for (const name of ["w29_pN-mx0g6qb2-475a0f8a", terminal]) {
      expect(isUploadImagePath(`/home/me/.local/state/collie/uploads/${name}.png`)).toBe(true);
      expect(isUploadImagePath(`C:\\Users\\Jane Doe\\collie\\uploads\\${name}.jpg`)).toBe(true);
    }
  });

  it("keeps paths distinct from prose, commands, and malformed names", () => {
    for (const path of [`/tmp/uploads/${terminal}.txt`, `/tmp/uploads/${terminal}.png more`,
      `/tmp/uploads/${terminal}.png/extra`, "/tmp/uploads/term.abc.mx0g6qb2-475a0f8a.png", "/status"]) {
      expect(isUploadImagePath(path)).toBe(false);
    }
  });

  it("splits multiple terminal-owned images from the surrounding message", () => {
    const path = `/tmp/uploads/${terminal}.png`;
    expect(pastePieces(`look ${path}\n${path}`)).toEqual(["look", path, path]);
    expect(pastePieces(`look ${path}\n${path}`).filter(isUploadImagePath)).toHaveLength(2);
  });
});
