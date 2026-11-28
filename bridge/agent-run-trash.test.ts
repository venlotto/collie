import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityLedger } from "./activity.ts";
import { AgentRuns } from "./agent-runs.ts";
import { AgentRunTrash } from "./agent-run-trash.ts";
import { TRASH_RETENTION } from "./bot-trash.ts";
import type { SnapshotResponse } from "./types.ts";

const A = "20261128T030000-claudep-long-paste-abcd";
const B = "20261128T031000-claudep-questions-beef";
const snapshot = (): SnapshotResponse => ({ bridge: "connected", agents: [], tabs: [], sessions: [], ts: 0,
  workspaces: [{ workspaceId: "w1", label: "Collie", number: 1, focused: false, activeTabId: "", tabCount: 0, paneCount: 0 }], shellPanes: [] });

test("external bots can be trashed separately, restored after restart and purged without returning", async () => {
  const root = await mkdtemp(join(tmpdir(), "collie-run-trash-"));
  const dir = join(root, "runs");
  const ledger = new ActivityLedger({ stateDir: root });
  const stopped: string[] = [];
  let canStop = false;
  const load = () => new AgentRuns(dir, async id => { stopped.push(id); return canStop; }, ledger);
  try {
    await mkdir(dir);
    for (const id of [A, B]) await writeFile(join(dir, id + ".status"), JSON.stringify({ id, name: id,
      agent: "claudep", cwd: "/external/" + id, status: "running", created_at: new Date().toISOString() }));
    let source = load();
    await source.botAction(A, "trash", snapshot(), "default");
    source = load();
    let body = snapshot();
    await source.attach(body, "default");
    const removed = body.shellPanes.find(p => p.agentRun?.id === A)!;
    expect(removed.trash?.originalWorkspaceId).toBe("agent-runs");
    expect(body.shellPanes.find(p => p.agentRun?.id === B)?.trash).toBeUndefined();
    expect(stopped).toEqual([]);
    await expect(source.botAction(A, "purge", snapshot(), "default", undefined, removed.trash!.trashedAt - 1)).rejects.toThrow();
    expect(stopped).toEqual([]);
    await source.botAction(A, "restore", snapshot(), "default", undefined, removed.trash!.trashedAt);
    body = snapshot(); await source.attach(body, "default");
    expect(body.shellPanes.find(p => p.agentRun?.id === A)?.trash).toBeUndefined();
    await source.botAction(A, "move", snapshot(), "default", "w1");
    await source.botAction(A, "trash", snapshot(), "default");
    body = snapshot(); await source.attach(body, "default");
    const at = body.shellPanes.find(p => p.agentRun?.id === A)!.trash!.trashedAt;
    await expect(source.botAction(A, "purge", snapshot(), "default", undefined, at)).rejects.toThrow("detener");
    canStop = true;
    await source.botAction(A, "purge", snapshot(), "default", undefined, at);
    body = snapshot(); await load().attach(body, "default");
    expect(body.shellPanes.map(p => p.agentRun?.id)).toEqual([B]);
    expect((await source.read(A))?.id).toBe(A); // Original runner records are not erased.
    await expect(source.botAction("../outside", "trash", snapshot(), "default")).rejects.toThrow();
  } finally { ledger.stop(); await rm(root, { recursive: true, force: true }); }
});

test("trash survives the normal one-day run listing and continuation changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "collie-run-chain-trash-"));
  const ledger = new ActivityLedger({ stateDir: root });
  try {
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    for (const id of [A, B]) await writeFile(join(root, id + ".status"), JSON.stringify({ id, name: id,
      agent: "claudep", cwd: "/external/" + id, status: "done", created_at: old, ended_at: old }));
    await writeFile(join(root, B + ".collie.json"), JSON.stringify({ version: 1, continues: A }));
    new AgentRunTrash(root).act(A, "trash", "agent-runs");
    const source = new AgentRuns(root, async () => false, ledger);
    const body = snapshot(); await source.attach(body, "default");
    expect(body.shellPanes).toHaveLength(1);
    expect(body.shellPanes[0]).toMatchObject({ agentRun: { id: B, rootId: A }, trash: { originalWorkspaceId: "agent-runs" } });
    await source.botAction(B, "purge", snapshot(), "default", undefined, body.shellPanes[0]!.trash!.trashedAt);
    const after = snapshot(); await source.attach(after, "default");
    expect(after.shellPanes).toHaveLength(0);
  } finally { ledger.stop(); await rm(root, { recursive: true, force: true }); }
});

test("expired trash cannot be restored and purged entries cannot be resurrected", async () => {
  const root = await mkdtemp(join(tmpdir(), "collie-run-expiry-"));
  let now = 1000;
  try {
    const store = new AgentRunTrash(root, () => now);
    store.act(A, "trash", "agent-runs");
    now += TRASH_RETENTION;
    expect(store.expired(store.read().get(A)!)).toBe(true);
    expect(() => store.act(A, "restore", "agent-runs", undefined, 1000)).toThrow();
    store.act(A, "purge", "agent-runs", undefined, 1000);
    expect(() => store.act(A, "trash", "agent-runs")).toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("trashing a bound run hides its own terminal but keeps a reused pane visible", async () => {
  const root = await mkdtemp(join(tmpdir(), "collie-run-reused-"));
  const ledger = new ActivityLedger({ stateDir: root });
  try {
    await writeFile(join(root, A + ".status"), JSON.stringify({ id: A, name: "External", agent: "claudep",
      cwd: "/external", herdr_pane: "w1:p1", herdr_workspace: "w1", status: "done", created_at: new Date().toISOString() }));
    const source = new AgentRuns(root, async () => false, ledger);
    const body = snapshot();
    body.shellPanes.push({ paneId: "w1:p1", terminalId: "old-terminal", workspaceId: "w1", workspaceNumber: 1,
      workspaceLabel: "Collie", tabId: "w1:t1", agent: "shell", status: "unknown", kind: "shell", cwd: "/external", focused: false });
    await source.botAction(A, "trash", body, "default");
    const own = structuredClone(body); await source.attach(own, "default");
    expect(own.shellPanes).toHaveLength(1);
    expect(own.shellPanes[0]?.trash).toBeDefined();
    body.shellPanes[0]!.terminalId = "replacement-terminal";
    await source.attach(body, "default");
    expect(body.shellPanes).toHaveLength(2);
    expect(body.shellPanes[0]?.terminalId).toBe("replacement-terminal");
    expect(body.shellPanes[0]?.trash).toBeUndefined();
  } finally { ledger.stop(); await rm(root, { recursive: true, force: true }); }
});
