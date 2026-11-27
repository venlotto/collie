import { asJsonObject, type JsonObject } from "../json";
import { PROFILE_FILES } from "./profiles/index";
import { parseProfile } from "./profile";

describe("the whole-paste image rule", () => {
  it("a paste image token without the whole paste names paste.image, even without a block minimum", () => {
    const raw: JsonObject = structuredClone(PROFILE_FILES.claude);
    const paste = asJsonObject(raw.paste);
    if (paste === undefined) throw new Error("the Claude profile has no paste rule");
    delete paste.blockMinChars;
    paste.block = false;
    expect(() => parseProfile(raw)).toThrow("paste.image");
  });
});
