import { describe, expect, it } from "vitest";
import { arrange, arrive, capacityOf, closeWindow, EMPTY_DESK, gridOf, isDesk, minimise, nextFocus, prune, toggleMax, type Desk } from "./bot-desk";

const desk = (...wins: [string, boolean, number][]): Desk => ({ wins: wins.map(([key, min, at]) => ({ key, min, at })), max: null });

describe("the desk's steps", () => {
  it("arrival puts a chat on the desk, brings it out of the tray and makes it the newest focus", () => {
    const a = arrive(EMPTY_DESK, "a", 1);
    expect(a.wins).toEqual([{ key: "a", min: false, at: 1 }]);
    const b = arrive(minimise(arrive(a, "b", 2), "b"), "b", 3);
    expect(b.wins.map(w => [w.key, w.min, w.at])).toEqual([["a", false, 1], ["b", false, 3]]);
  });

  it("arriving at another chat lets a maximised window step back; the maximised one keeps it", () => {
    const d = toggleMax(desk(["a", false, 1], ["b", false, 2]), "a");
    expect(arrive(d, "a", 5).max).toBe("a");
    expect(arrive(d, "b", 5).max).toBeNull();
  });

  it("minimising and closing release the maximised window", () => {
    const d = toggleMax(desk(["a", false, 1], ["b", false, 2]), "b");
    expect(minimise(d, "b")).toEqual({ wins: [{ key: "a", min: false, at: 1 }, { key: "b", min: true, at: 2 }], max: null });
    expect(closeWindow(d, "b")).toEqual({ wins: [{ key: "a", min: false, at: 1 }], max: null });
  });

  it("the focus goes to the most recent window still on the desk", () => {
    const d = desk(["a", false, 3], ["b", true, 9], ["c", false, 5], ["d", false, 1]);
    expect(nextFocus(d, "c")).toBe("a");
    expect(nextFocus(desk(["a", false, 1]), "a")).toBeNull();
  });

  it("prune forgets gone chats and leaves an unchanged desk as the same object", () => {
    const d = toggleMax(desk(["a", false, 1], ["b", false, 2]), "b");
    expect(prune(d, new Set(["a", "b"]))).toBe(d);
    expect(prune(d, new Set(["a"]))).toEqual({ wins: [{ key: "a", min: false, at: 1 }], max: null });
  });
});

describe("the desk's geometry", () => {
  it("a laptop panel holds two windows across; a phone-width panel is not a desk", () => {
    expect(capacityOf(930, 600)).toEqual({ cols: 2, rows: 1 });
    expect(capacityOf(930, 700)).toEqual({ cols: 2, rows: 2 });
    expect(isDesk(capacityOf(930, 700))).toBe(true);
    expect(isDesk(capacityOf(700, 700))).toBe(false);
    expect(capacityOf(1560, 960)).toEqual({ cols: 3, rows: 2 });
  });

  it("windows fill one row first, then two rows evenly", () => {
    const c = { cols: 3, rows: 2 };
    expect(gridOf(1, c)).toEqual({ cols: 1, rows: 1 });
    expect(gridOf(3, c)).toEqual({ cols: 3, rows: 1 });
    expect(gridOf(4, c)).toEqual({ cols: 2, rows: 2 });
    expect(gridOf(5, c)).toEqual({ cols: 3, rows: 2 });
    expect(gridOf(4, { cols: 2, rows: 1 })).toEqual({ cols: 2, rows: 1 });
  });

  it("a small desk keeps the focus and the most recent windows; the rest wait in the tray in desk order", () => {
    const d = desk(["a", false, 1], ["b", true, 9], ["c", false, 5], ["d", false, 7]);
    expect(arrange(d, "a", { cols: 2, rows: 1 })).toEqual({ shown: ["a", "d"], tray: ["b", "c"] });
    expect(arrange(d, null, { cols: 3, rows: 1 })).toEqual({ shown: ["a", "c", "d"], tray: ["b"] });
  });

  it("a maximised window is the only one shown", () => {
    const d = toggleMax(desk(["a", false, 1], ["b", true, 2], ["c", false, 3]), "c");
    expect(arrange(d, "c", { cols: 3, rows: 2 })).toEqual({ shown: ["c"], tray: ["a", "b"] });
  });
});
