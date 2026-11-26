import { DEFAULT_BOT_NAMES, defaultBotName } from "./bot-default-name";

it("picks a name from the list", () => {
  expect(defaultBotName([], () => 0)).toBe(DEFAULT_BOT_NAMES[0]);
  expect(defaultBotName([], () => 0.9999)).toBe(DEFAULT_BOT_NAMES.at(-1));
});

it("skips names already on screen, ignoring case", () => {
  expect(defaultBotName([DEFAULT_BOT_NAMES[0].toUpperCase()], () => 0)).toBe(DEFAULT_BOT_NAMES[1]);
});

it("numbers a name once every name is taken", () => {
  const all = [...DEFAULT_BOT_NAMES, `${DEFAULT_BOT_NAMES[0]} 2`];
  expect(defaultBotName(all, () => 0)).toBe(`${DEFAULT_BOT_NAMES[0]} 3`);
});
