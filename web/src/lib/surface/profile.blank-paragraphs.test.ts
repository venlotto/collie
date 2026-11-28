import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { asJsonObject, parseJsonObject, type JsonObject } from "../json";
import { parseProfile, ProfileError } from "./profile";

function rawProfile(edit: (frame: JsonObject) => void): JsonObject {
  const raw = parseJsonObject(readFileSync(join(import.meta.dirname, "profiles", "codex.json"), "utf8"));
  if (raw === undefined) throw new Error("codex.json is not a JSON object");
  const frame = asJsonObject(asJsonObject(raw.idle)?.frame);
  if (frame === undefined) throw new Error("codex.json has no idle.frame");
  edit(frame);
  return raw;
}

describe("the native editor's blank paragraph budget", () => {
  for (const value of [0, 101, "100"]) {
    it(`rejects ${JSON.stringify(value)} as a blank row budget`, () => {
      const raw = rawProfile(frame => { frame.maxBlankRows = value; });
      try {
        parseProfile(raw);
        throw new Error("accepted an invalid blank row budget");
      } catch (error) {
        expect(error).toBeInstanceOf(ProfileError);
        expect(error).toMatchObject({ path: "idle.frame.maxBlankRows" });
      }
    });
  }

  it("leaves the default unchanged for profiles without a blank row budget", () => {
    expect(parseProfile(rawProfile(frame => { delete frame.maxBlankRows; })).idle.frame.maxBlankRows).toBeUndefined();
  });
});
