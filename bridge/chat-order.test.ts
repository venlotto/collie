import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatOrderStore } from "./chat-order.ts";

test("shared order survives reopening, merges relative moves and rejects stale destinations", () => {
  const dir = mkdtempSync(join(tmpdir(), "collie-order-"));
  try {
    const store = new ChatOrderStore(dir);
    const rows = ["a", "b", "c"];
    store.place("mine", "west", rows, "c", "a");
    const next = new ChatOrderStore(dir);
    expect(next.read("mine")).toEqual([{ workspaceId: "west", paneIds: ["c", "a", "b"] }]);
    expect(next.read("other")).toEqual([]);
    expect(next.place("mine", "west", [...rows, "d"], "a", null).paneIds).toEqual(["c", "b", "d", "a"]);
    expect(() => store.place("mine", "west", rows, "c", "d")).toThrow();
    expect(store.read("mine")[0]?.paneIds).toEqual(["c", "b", "d", "a"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
