import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FakePane } from "./protocol.rig.ts";
import { SurfaceShadow } from "./shadow.ts";

test("a drawn Codex startup box without the editor status cannot close its launch window", async () => {
  const pane = new FakePane("codex");
  // The initial footer can paint before the model status; it still matches the warning-frame alternate.
  pane.codexStatus = "  ⚠ 1 warning · f2 to view";
  const shadow = new SurfaceShadow({ mux: pane, pollMs: 1000, log: () => {}, compare: false, version: async () => "0.172.0" });
  const agent = { paneId: "%1", workspaceId: "w1", workspaceLabel: "lab", workspaceNumber: 1, tabId: "w1:t1", agent: "codex", status: "idle" as const, cwd: "/tmp", focused: false };
  await shadow.observe([agent]);
  expect(shadow.boxOf("%1")?.box).toBe("");
  expect(shadow.startupReady("%1")).toBe(false);
  pane.codexStatus = "  GPT-6-Astra high · /tmp";
  await shadow.observe([agent]);
  expect(shadow.startupReady("%1")).toBe(true);
  pane.fixed = readFileSync(new URL("captures/codex--v0172-startup-trust--w52.txt", import.meta.url), "utf8");
  await shadow.observe([agent]);
  expect(shadow.startupReady("%1")).toBe(false);
  expect(shadow.askOnScreen("%1")).toBe(true);
});
