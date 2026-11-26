import { expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityLedger } from "./activity.ts";
import { AgentRuns } from "./agent-runs.ts";
import { claudeJournal } from "./journal/claude.ts";
import { codexJournal } from "./journal/codex.ts";
import { LiveWindows } from "./journal/live.ts";
import { TranscriptStore } from "./journal/store.ts";
import type { SnapshotResponse } from "./types.ts";

test("join shell panes without hooks, follow the main rollout and stop only the selected run", async () => {
  const root = await mkdtemp(join(tmpdir(), "collie-agent-run-"));
  try {
    const dir = join(root, "runs");
    const day = join(root, "sessions/2026/11/26");
    const project = join(root, "projects/test");
    await Promise.all([dir,day,project].map(path => mkdir(path, { recursive: true })));
    const main = "20261126T030000-informe-abcd";
    const sid = "11111111-2222-4444-8888-999999999999";
    const journal = join(day, "rollout-fixture-" + sid + ".jsonl");
    const status = { id: main, name: "Informe", cwd: "/work/informe", agent: "codexp",
      created_at: new Date().toISOString(), status: "running", herdr_pane: null, central: { herdr_pane: "w1:old" } };
    const row = (role: string, text: string) => JSON.stringify({ type: "response_item", timestamp: status.created_at,
      payload: { type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] } }) + "\n";
    await writeFile(join(dir, main + ".status"), JSON.stringify(status));
    await writeFile(join(dir, main + ".log"), "session id: " + sid + "\nuser\nFixture");
    await writeFile(journal, row("user", "Prepara el informe."));
    await writeFile(join(day, "rollout-fixture-aaaaaaaa-2222-4444-8888-999999999999.jsonl"), row("user", "otro agente"));
    const other = "20261126T031000-otro-0123";
    await writeFile(join(dir, other + ".status"), JSON.stringify({ ...status, id: other, cwd: "/otro", status: "failed" }));
    await writeFile(join(dir, other + ".log"), "Salida del agente");
    const stop: string[][] = [];
    const source = new AgentRuns(dir, async (...args) => { stop.push(args); return true; }, new ActivityLedger({ stateDir: root }));
    // SAFETY: attach reads only the workspace identity and shell pane fields populated here.
    const body = { workspaces: [{ workspaceId: "w1", label: "Collie" }],
      shellPanes: [{ paneId: "w1:p1", cwd: status.cwd, kind: "shell", workspaceId: "w1" }] } as unknown as SnapshotResponse;
    await source.attach(body, "default");
    expect(body.shellPanes.map(p => [p.paneId,p.workspaceId,p.agentRun?.status])).toEqual([
      ["w1:p1","w1","running"],["agent-run:" + other,"agent-runs","failed"]]);
    const adapters = { codex: codexJournal(join(root, "sessions")), claude: claudeJournal(join(root, "projects")) };
    let clock = Date.now();
    const live = new LiveWindows(new TranscriptStore(), () => clock);
    const read = (id: string) => source.chat(id, adapters, live, { limit: 50 }, false);
    expect((await read(main))?.upserts.map(e => e.role)).toEqual(["user"]);
    clock += 5000;
    await appendFile(journal, row("assistant", "Informe listo."));
    expect((await read(main))?.upserts.map(e => e.parts[0])).toEqual([
      { kind: "text", text: "Prepara el informe." }, { kind: "text", text: "Informe listo." }]);
    expect((await read(other))?.upserts[0]?.parts[0]).toEqual({ kind: "text", text: "Salida del agente" });
    expect(await source.stop(other)).toBe(false);
    expect(await source.stop(main)).toBe(true);
    expect(stop).toEqual([[main, dir]]);
    await writeFile(join(dir, main + ".status"), JSON.stringify({ ...status, status: "done", agent: "kimi", session_id: sid }));
    await writeFile(join(project, sid + ".jsonl"), JSON.stringify({ type: "assistant", uuid: "fixture", timestamp: status.created_at,
      message: { role: "assistant", content: [{ type: "text", text: "Respuesta de Claude." }] } }) + "\n");
    expect((await read(main))?.upserts[0]?.parts[0]).toEqual({ kind: "text", text: "Respuesta de Claude." });
    expect((await source.read(main))?.status).toBe("done");
    expect(await source.read("../outside")).toBeNull();
    await rm(join(dir, other + ".log"));
    await symlink(journal, join(dir, other + ".log"));
    expect(await read(other)).toBeNull();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a settled run shares its read receipt across pane reassignment, polls and a bridge restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "collie-run-seen-"));
  const dir = join(root, "runs");
  let now = Date.now();
  const clock = () => now;
  const ledger = new ActivityLedger({ stateDir: root }, clock);
  const resumed = new ActivityLedger({ stateDir: root }, clock);
  try {
    await mkdir(dir);
    const id = "20261126T030000-informe-abcd";
    const end = now - 1000;
    const run = { id, status: "failed", name: "Informe", agent: "codexp", cwd: "/work/informe",
      started_at: new Date(end - 3000).toISOString(), ended_at: new Date(end).toISOString() };
    const file = join(dir, id + ".status");
    await writeFile(file, JSON.stringify(run));
    const source = new AgentRuns(dir, async () => false, ledger);
    async function snapshot(runs: AgentRuns, bound: boolean) {
      // SAFETY: attach only reads workspace and shell pane fields.
      const body = { workspaces: [], shellPanes: bound ? [{ paneId: "w1:p1", cwd: run.cwd,
        kind: "shell", workspaceId: "w1", lastSeenAt: now }] : [] } as unknown as SnapshotResponse;
      await runs.attach(body, "default");
      return body.shellPanes[0];
    }
    await source.chat(id, null, null, { limit: 3 }, false);
    expect(await snapshot(source, true)).toMatchObject({ paneId: "w1:p1", lastActiveAt: end, lastSeenAt: 0 });
    await source.chat(id, null, null, { limit: 50 }, true);
    const firstSeen = now;
    now += 5000;
    await source.chat(id, null, null, { limit: 50 }, true);
    ledger.reconcile("default", []);
    expect(await snapshot(source, false)).toMatchObject({ paneId: "agent-run:" + id, lastSeenAt: firstSeen });
    await ledger.flush();
    await resumed.load();
    const recovered = new AgentRuns(dir, async () => false, resumed);
    expect(await snapshot(recovered, true)).toMatchObject({ lastSeenAt: firstSeen });
  } finally {
    ledger.stop();
    resumed.stop();
    await rm(root, { recursive: true, force: true });
  }
});
