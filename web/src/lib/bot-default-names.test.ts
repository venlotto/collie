import { describe, expect, it } from "vitest";
import { BOT_DEFAULT_NAMES, randomBotName } from "./bot-default-names";

describe("randomBotName", () => {
  it("picks from the list", () => expect(BOT_DEFAULT_NAMES).toContain(randomBotName()));
  it("skips names already taken while any is free", () => {
    const taken = new Set(BOT_DEFAULT_NAMES.slice(1));
    expect(randomBotName(taken, () => 0.99)).toBe(BOT_DEFAULT_NAMES[0]);
  });
  it("still names the bot when every name is taken", () =>
    expect(BOT_DEFAULT_NAMES).toContain(randomBotName(new Set(BOT_DEFAULT_NAMES))));
});
