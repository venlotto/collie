import { describe, expect, test } from "bun:test";
import { botUploadPrefix } from "../bot-trash.ts";
import { isUploadImagePath } from "../../web/src/lib/upload-path.ts";
import { reservedLead } from "../../web/src/lib/surface/send.ts";
import { profileFor } from "../../web/src/lib/surface/profile.ts";
import { uploadAlone, wholePaste } from "./protocol.ts";

describe("the uploader's terminal owner format reaches the send protocol", () => {
  const path = `/tmp/collie/uploads/${botUploadPrefix("default", "term_test")}mx0g6qb2-475a0f8a.png`;

  test("a generated attachment name is an image and never a slash command", () => {
    expect(isUploadImagePath(path)).toBe(true);
    expect(reservedLead(`${path} describe this`, ["/", "!"])).toBeNull();
    expect(reservedLead(path.replace(".png", ".txt"), ["/", "!"])).toBeNull();
  });

  test("Codex gets a single paste including the attachment and all paragraphs", () => {
    const lines = [path, "", "describe this"];
    const match = profileFor("codex", "0.172.0", { log: () => undefined });
    expect(wholePaste(match, lines)).toMatchObject({ images: 0, lines, literal: lines });
  });

  test("Claude can attach the same image alone or inside a longer message", () => {
    const match = profileFor("claude", "2.1.332", { log: () => undefined });
    const onDisk = (file: string) => file === path;
    expect(uploadAlone(match, [path], onDisk)).toMatchObject({ images: 1, literal: [path] });
    expect(wholePaste(match, [path, "describe this"], onDisk)).toMatchObject({ images: 1, lines: ["describe this"] });
    expect(uploadAlone(match, [path], () => false)).toBeNull();
  });
});
