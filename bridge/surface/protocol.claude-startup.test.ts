// Claude Code 2.1.332 draws a shell before its first input box. A plain send then waits in the
// bridge's hold queue with no key at all, goes once the box is free, and expires on the launch bound.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SendAnswer } from "../../web/src/lib/surface/send.ts";
import type { Surface } from "../../web/src/lib/surface/surface.ts";
import { HoldStore } from "./holds.ts";
import { dir, FakePane, rig, useScratchDir } from "./protocol.rig.ts";

useScratchDir();

const FIXTURES = fileURLToPath(new URL("fixtures/", import.meta.url));
const SHELL = readFileSync(join(FIXTURES, "claude--v2332-startup-shell--w54.txt"), "utf8");
const STARTING: Surface = { revision: 1, turn: "unknown", modal: "none", composer: "unknown" };
const FREE: Surface = { revision: 1, turn: "idle", modal: "none", composer: "empty" };
const RUNNING: Surface = { revision: 1, turn: "running", modal: "none", composer: "empty" };

function launched(withHolds = true) {
  const pane = new FakePane("claude");
  pane.fixed = SHELL;
  const clock = { now: 1_000_000 };
  const holds = withHolds ? new HoldStore(join(dir, "held"), () => clock.now) : undefined;
  const r = rig({ pane, clock, holds, block: true, linePaste: false, version: "2.1.332", starting: () => "claude" });
  const tick = (surface: Surface = STARTING): Promise<(SendAnswer | null)[]> =>
    Promise.all(r.protocol.tickHolds("main", () => surface, () => (surface === FREE ? "" : null)));
  return { ...r, holds, tick };
}

describe("Claude Code 2.1.332 startup sends", () => {
  test("a shell-only screen holds plain sends without keys, then sends them once in order", async () => {
    const r = launched();
    const first = await r.send("responde OK y para", { id: "startup-000001" });
    expect(first).toMatchObject({
      cause: "starting",
      receipt: { requestId: "startup-000001", outcome: "held", keys: [] },
      detail: "The agent is starting. Collie keeps this and sends it when the input box is ready.",
    });
    expect(r.pane.calls).toEqual([]);
    expect(r.pane.keysSeen).toEqual([]);
    expect(r.holds?.get("startup-000001")).toMatchObject({ state: "held", cause: "starting", tries: 0 });
    const firstEntry = r.holds?.get("startup-000001");
    if (firstEntry === null || firstEntry === undefined) throw new Error("the first startup send was not held");
    expect(firstEntry.expiresAt - firstEntry.heldAt).toBe(120_000);

    const second = await r.send("responde PONG y para", { id: "startup-000002" });
    expect(second).toMatchObject({ cause: "starting", receipt: { outcome: "held", keys: [] } });
    expect(r.holds?.get("startup-000002")).toMatchObject({ cause: "starting", expiresAt: firstEntry.expiresAt });
    expect(r.pane.calls).toEqual([]);
    expect(await r.tick()).toEqual([]);

    r.pane.fixed = null;
    const [released] = await r.tick(FREE);
    expect(released?.receipt).toMatchObject({ requestId: "startup-000001", outcome: "sent" });
    expect(r.pane.transcript.filter((row) => row.startsWith("> responde"))).toEqual(["> responde OK y para"]);

    // The first answer starts a turn; the second held message follows it, never ahead of it.
    expect(await r.tick(RUNNING)).toEqual([]);
    expect(await r.tick(FREE)).toEqual([]);
    const [next] = await r.tick(FREE);
    expect(next?.receipt).toMatchObject({ requestId: "startup-000002", outcome: "sent" });
    expect(r.pane.transcript.filter((row) => row.startsWith("> responde"))).toEqual(["> responde OK y para", "> responde PONG y para"]);
    expect(r.holds?.list()).toEqual([]);
  });

  test("a startup hold expires after two minutes with its text kept and no key written", async () => {
    const r = launched();
    await r.send("no arranques tarde", { id: "startup-000003" });
    r.clock.now += 120_000;
    expect(await r.tick()).toEqual([]);
    expect(r.protocol.heldOf("main", "%1")).toEqual([
      expect.objectContaining({ requestId: "startup-000003", state: "ended", outcome: "expired", cause: "starting", text: "no arranques tarde" }),
    ]);
    expect(r.pane.calls).toEqual([]);
    expect(r.pane.keysSeen).toEqual([]);
  });

  test("without a hold store the old refusal stays, and a command is never held for later", async () => {
    const plain = launched(false);
    expect((await plain.send("hola")).receipt).toMatchObject({ outcome: "refused", reason: "probe_failed", keys: [] });
    expect(plain.pane.calls).toEqual([]);

    const command = launched();
    expect((await command.send("/help", { mode: "command" })).receipt).toMatchObject({ outcome: "refused", reason: "probe_failed", keys: [] });
    expect(command.holds?.list()).toEqual([]);
    expect(command.pane.calls).toEqual([]);
  });
});
