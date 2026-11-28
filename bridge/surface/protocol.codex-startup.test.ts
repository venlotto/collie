import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HoldStore } from "./holds.ts";
import { LaunchWindow } from "../launch-window.ts";
import { SendProtocol } from "./protocol.ts";
import { dir, FakePane, rig, useScratchDir } from "./protocol.rig.ts";

useScratchDir();
const trust = readFileSync(new URL("captures/codex--v0172-startup-trust--w52.txt", import.meta.url), "utf8");
const FREE = { revision: 1, turn: "idle", modal: "none", composer: "empty" } as const;
function launched() {
  const pane = new FakePane("codex");
  const clock = { now: 1_000_000 };
  const holds = new HoldStore(join(dir, "held"), () => clock.now);
  const r = rig({ pane, clock, holds, harness: "codex", version: "0.172.0" });
  const window = new LaunchWindow(() => clock.now);
  window.mark("main", "%1", "codex");
  const protocol = new SendProtocol({ ...r.deps,
    starting: (id, named) => window.starting("main", id, named),
    framed: (id, harness) => window.framed("main", id, harness),
    deaf: (id, harness, at) => window.deaf("main", id, harness, at),
    pending: (id) => window.pending("main", id),
  });
  return { pane, clock, holds, protocol, window,
    send: () => protocol.handle({ id: "startup-codex-01", text: "reply with READY", mode: "send", fromPhone: true }, { session: "main", paneId: "%1", harness: "codex" }),
    tick: () => Promise.all(protocol.tickHolds("main", () => ({ ...FREE, composer: pane.box ? "draft" : "empty" }), () => pane.box)),
  };
}

describe("Codex first-message delivery", () => {
  test("slow startup reads keep the probe proof and its cleanup inside a measured bound", async () => {
    const r = launched();
    r.pane.beforeRead = () => { r.clock.now += 900; };
    expect((await r.send()).receipt?.outcome).toBe("sent");
    expect(r.pane.transcript).toContain("› reply with READY");
    expect(r.pane.transcript).not.toContain("› ⌁");
  });

  test("a poll calling the known startup placeholder a draft does not strand the hold", async () => {
    const r = launched(); r.pane.fixed = trust;
    await r.send(); r.pane.fixed = null;
    for (let i = 0; i < 5; i++) {
      r.clock.now += 1000;
      await Promise.all(r.protocol.tickHolds("main", () => ({ ...FREE, composer: "draft" }), () => "Ask Codex to do anything"));
    }
    expect(r.pane.transcript).toContain("› reply with READY");
  });

  test("the bounded startup wait expires visibly with the original text still recoverable", async () => {
    const r = launched(); r.pane.fixed = trust;
    await r.send();
    r.clock.now += 120001;
    await r.tick();
    expect(r.holds.get("startup-codex-01")).toMatchObject({ state: "ended", outcome: "expired", cause: "starting", text: "reply with READY" });
    expect(r.pane.calls).toEqual([]);
  });

  test("a startup release whose read exceeds the whole request bound retries without a false unknown", async () => {
    const r = launched(); r.pane.fixed = trust;
    await r.send(); r.pane.fixed = null;
    r.pane.beforeRead = () => { r.clock.now += 13000; };
    r.clock.now += 1000;
    const retry = await r.tick();
    expect(retry[0]?.receipt).toMatchObject({ outcome: "held", keys: [] });
    r.pane.beforeRead = null;
    for (let i = 0; i < 5; i++) { r.clock.now += 1000; await r.tick(); }
    expect(r.pane.transcript).toContain("› reply with READY");
  });

  test("the real painted header is not a ready editor: no probe until its status row arrives", async () => {
    const r = launched();
    r.pane.fixed = readFileSync(new URL("captures/codex--v0172-startup-header--w56.txt", import.meta.url), "utf8");
    const held = await r.send();
    expect(held).toMatchObject({ cause: "starting", receipt: { outcome: "held", keys: [] } });
    expect(r.pane.calls).toEqual([]);
    r.pane.fixed = null;
    for (let i = 0; i < 5; i++) { r.clock.now += 1000; await r.tick(); }
    expect(r.pane.transcript).toContain("› reply with READY");
  });

  test("an incomplete cleanup read keeps the startup send and never submits the marker", async () => {
    const r = launched(); r.pane.backspaceRestores = false;
    expect((await r.send()).receipt).toMatchObject({ outcome: "held", keys: ["probe", "Backspace"] });
    expect(r.pane.keysSeen).not.toContain("Enter");
    r.pane.backspaceRestores = true;
    for (let i = 0; i < 5; i++) { r.clock.now += 1000; await r.tick(); }
    expect(r.pane.transcript).toContain("› reply with READY");
    expect(r.pane.transcript).not.toContain("› ⌁");
  });

  test("the real trust dialog holds the message on disk without probing, then delivers after the answer", async () => {
    const r = launched(); r.pane.fixed = trust;
    const held = await r.send();
    expect(held.receipt).toMatchObject({ outcome: "held", keys: [] });
    expect(held.cause).toBe("starting");
    expect(r.pane.calls).toEqual([]);
    const restored = new HoldStore(join(dir, "held"), () => r.clock.now);
    expect(restored.get("startup-codex-01")?.text).toBe("reply with READY");
    r.pane.fixed = null;
    for (let i = 0; i < 5; i++) { r.clock.now += 1000; await r.tick(); }
    expect(r.pane.transcript.filter(row => row === "› reply with READY")).toHaveLength(1);
    expect(r.pane.transcript).not.toContain("› ⌁");
  });

  test("a probe swallowed by a starting editor keeps the first send, never an Enter, and retries after cleanup", async () => {
    const r = launched(); r.pane.swallow = true;
    const held = await r.send();
    expect(held.receipt).toMatchObject({ outcome: "held", keys: ["probe"] });
    expect(r.pane.keysSeen).not.toContain("Enter");
    expect(r.window.pending("main", "%1")).toBe(1);
    expect(r.holds.get("startup-codex-01")?.text).toBe("reply with READY");
    r.pane.swallow = false; r.pane.box = "⌁";
    for (let i = 0; i < 5; i++) { r.clock.now += 1000; await r.tick(); }
    expect(r.pane.transcript.filter(row => row === "› reply with READY")).toHaveLength(1);
    expect(r.pane.transcript).not.toContain("› ⌁");
  });
});
