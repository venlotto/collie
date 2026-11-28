import { expect, test, spyOn } from "bun:test";
import { FakePane, rig, useScratchDir } from "./protocol.rig.ts";
import { SendProtocol } from "./protocol.ts";

useScratchDir();

test("latest delivery is scoped to session and pane generation, survives restart, and a later success clears failure", async () => {
  const pane = new FakePane("codex");
  pane.box = "unsent desktop draft";
  const r = rig({ pane, harness: "codex", version: "0.172.0" });
  const fail = await r.send("new message");
  expect(r.protocol.lastSend("main", "%1")).toMatchObject({ requestId: fail.receipt!.requestId, outcome: "refused" });
  expect(r.protocol.lastSend("other", "%1")).toBeUndefined();
  expect(new SendProtocol({ ...r.deps, generation: () => "replacement" }).lastSend("main", "%1")).toBeUndefined();
  const restarted = new SendProtocol(r.deps);
  expect(restarted.lastSend("main", "%1")).toMatchObject({ outcome: "refused" });
  r.clock.now += 100;
  pane.box = "";
  const sent = await r.send("new message");
  expect(r.protocol.lastSend("main", "%1")).toMatchObject({ requestId: sent.receipt!.requestId, outcome: "sent" });
  await r.send("", { mode: "prepare" });
  expect(r.protocol.lastSend("main", "%1")?.requestId).toBe(sent.receipt!.requestId);
});

test("an accepted request has a visible pending state and becomes unconfirmed on recovery", () => {
  const r = rig();
  r.deps.store.accept({ id: "restart-0001", session: "main", paneId: "%1", paneGeneration: "gen-1",
    surfaceRevision: 1, mode: "send", text: "hello" });
  expect(r.protocol.lastSend("main", "%1")?.outcome).toBe("pending");
  r.deps.store.recover(SendProtocol.crashReceipt);
  expect(r.protocol.lastSend("main", "%1")?.outcome).toBe("unknown");
});

test("delivery projection rereads records only after mutations and reflects pruning", () => {
  const r = rig();
  const listing = spyOn(r.deps.store, "list");
  expect(r.protocol.lastSend("main", "%1")).toBeUndefined();
  r.protocol.lastSend("main", "%2");
  expect(listing).toHaveBeenCalledTimes(1);
  r.deps.store.accept({ id: "projection-0001", session: "main", paneId: "%1", paneGeneration: "gen-1",
    surfaceRevision: 1, mode: "send", text: "hello" });
  r.deps.store.recover(SendProtocol.crashReceipt);
  expect(r.protocol.lastSend("main", "%1")?.outcome).toBe("unknown");
  r.clock.now += 100;
  r.deps.store.prune(1);
  expect(r.protocol.lastSend("main", "%1")).toBeUndefined();
  listing.mockRestore();
});
