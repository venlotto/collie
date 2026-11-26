import { describe, expect, it } from "vitest";
import { botDisplayRowParts, parseBotDisplayRow, resolvePaneView } from "./bot-display-wire";

describe("per-bot display precedence", () => {
  it("uses Messages without a record, lets the bot outrank the device, and keeps agent views first", () => {
    expect(resolvePaneView(undefined, undefined, "terminal")).toBe("terminal");
    expect(resolvePaneView(undefined, "chat", "terminal")).toBe("chat");
    expect(resolvePaneView(undefined, "terminal", "chat")).toBe("terminal");
    expect(resolvePaneView("terminal", "chat", "chat")).toBe("terminal");
    expect(resolvePaneView(null, "chat", "terminal")).toBe("chat");
  });

  it("accepts only a full row address and one of the two views", () => {
    const row = "\u0000\u0000w1:p1";
    expect(parseBotDisplayRow({ row, view: "chat" })).toEqual({ row, view: "chat" });
    expect(botDisplayRowParts(row)).toEqual({ host: "", session: "", paneId: "w1:p1" });
    for (const value of [{ row: "bad", view: "chat" }, { row, view: "raw" }, { row, view: "chat", extra: true }]) {
      expect(parseBotDisplayRow(value)).toBeUndefined();
    }
  });
});
