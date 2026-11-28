import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityLedger } from "./activity.ts";
import { AgentRuns } from "./agent-runs.ts";
import { AuditLog } from "./audit.ts";
import { BotTrash } from "./bot-trash.ts";
import { loadConfig } from "./config.ts";
import { muxOk } from "./mux/types.ts";
import { NotifyPrefsStore } from "./notify-prefs.ts";
import { filePairingIo, PairingStore } from "./pairing.ts";
import { Push } from "./push.ts";
import { startServer } from "./server.ts";
import { SessionRegistry, type SessionParts } from "./sessions.ts";
import { Snooze } from "./snooze.ts";
import type { UpdateMonitor } from "./update.ts";
import type { SnapshotResponse } from "./types.ts";

function part<T>(value: Partial<T>): T {
  // SAFETY: only snapshot and bot-action are called; the empty runtime supplies every method they use.
  return value as T;
}

test("the paired HTTP route deletes an external bot, rejects unpaired writes and restores it", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "collie-trash-http-"));
  const cfg = { ...loadConfig({ HOME: stateDir, COLLIE_STATE_DIR: stateDir }), host: "127.0.0.1", port: 0 };
  const activity = new ActivityLedger(cfg);
  const registry = new SessionRegistry({ configRoot: stateDir, primarySocketPath: join(stateDir, "herdr.sock"), multiSession: false,
    factory: (): SessionParts => ({
      herdr: part<SessionParts["herdr"]>({ listSessions: async () => muxOk([]) }),
      engine: part<SessionParts["engine"]>({ current: () => ({ agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" }),
        noteAttention() {}, stop() {} }),
      poker: part<SessionParts["poker"]>({ stop() {} }), notifications: part<SessionParts["notifications"]>({ clearAll() {} }),
    }) });
  const pairing = new PairingStore(filePairingIo(stateDir));
  const token = (await pairing.enrolApproved("test-device")).token;
  const id = "20261128T030000-external-abcd";
  await writeFile(join(stateDir, id + ".status"), JSON.stringify({ id, name: "External bot", agent: "claudep", cwd: "/external",
    status: "done", created_at: new Date().toISOString(), ended_at: new Date().toISOString() }));
  const audit: string[] = [];
  const server = startServer({ cfg, registry, pairing, activity, push: new Push(cfg), snooze: new Snooze(cfg),
    notifyPrefs: new NotifyPrefsStore(cfg), version: "1.31.0", audit: new AuditLog(line => { audit.push(line); }),
    updateMonitor: part<UpdateMonitor>({ status: () => ({ current: "1.31.0", latest: "1.31.0", latestUrl: null,
      releaseAvailable: false, majorAvailable: null, majorUrl: null, installKind: "binary", dismissedVersion: null,
      dismissedCrewVersion: null, bridgeStale: false, restartNeeded: false, checkedAt: null }) }),
    crew: { mode: "solo", peerServesBrowser: false, conflict: null, trickReads: false },
    botTrash: new BotTrash(stateDir, () => undefined), agentRuns: new AgentRuns(stateDir, async () => false, activity),
  });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (body: { action: "trash" | "restore"; runId: string; trashedAt?: number }, authenticated = true) => fetch(base + "/api/bot-action", { method: "POST",
    headers: { origin: base, authorization: authenticated ? "Bearer " + token : "", "content-type": "application/json" }, body: JSON.stringify(body) });
  const snapshot = async (): Promise<SnapshotResponse> => {
    const res = await fetch(base + "/api/snapshot", { headers: { authorization: "Bearer " + token } });
    expect(res.status).toBe(200);
    // SAFETY: the real snapshot route serializes SnapshotResponse; assertions below check the fields under test.
    return await res.json() as SnapshotResponse;
  };
  try {
    expect((await post({ action: "trash", runId: id }, false)).status).toBe(403);
    expect((await post({ action: "trash", runId: id })).status).toBe(200);
    const conflict = await post({ action: "trash", runId: id });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ ok: false, error: "La selección de Papelera ha cambiado." });
    expect(audit.some(line => line.includes("bot.trash.refused"))).toBe(true);
    const workspaceConflict = await fetch(base + "/api/bot-action", { method: "POST",
      headers: { origin: base, authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ action: "trashWorkspace", workspaceId: "gone" }) });
    expect(workspaceConflict.status).toBe(409);
    expect(await workspaceConflict.json()).toEqual({ ok: false, error: "Esta sesión no admite la Papelera de workspaces." });
    expect(audit.some(line => line.includes("bot.trashWorkspace.refused"))).toBe(true);
    const body = await snapshot();
    expect(body.shellPanes).toHaveLength(1);
    expect(body.shellPanes[0]?.trash).toBeDefined();
    expect((await post({ action: "restore", runId: id, trashedAt: body.shellPanes[0]!.trash!.trashedAt })).status).toBe(200);
    expect((await snapshot()).shellPanes[0]?.trash).toBeUndefined();
  } finally { server.stop(true); activity.stop(); await rm(stateDir, { recursive: true, force: true }); }
});
