import type { JsonObject } from "../json";
import { PROFILE_FILES } from "./profiles/index";
import { parseProfile, ProfileError } from "./profile";

describe("a literal bracketed probe paste", () => {
  const withProbe = (probe: JsonObject, paste: JsonObject = { bracketed: true, block: true }): JsonObject => ({
    ...PROFILE_FILES.codex,
    probe: { char: "⌁", status: "verified", note: "test", ...probe },
    paste,
  });

  it("is a measured block-paste capability, never an unverified profile default", () => {
    expect(parseProfile(withProbe({ paste: true })).probe.paste).toBe(true);
    expect(parseProfile(withProbe({})).probe.paste).toBeUndefined();
  });

  it("requires bracketed whole-text paste support", () => {
    expect(() => parseProfile(withProbe({ paste: true }, { bracketed: true }))).toThrow(ProfileError);
    expect(() => parseProfile(withProbe({ paste: true }, { bracketed: false, block: true }))).toThrow(ProfileError);
    expect(() => parseProfile(withProbe({ paste: "yes" }))).toThrow(ProfileError);
  });
});
