import { asJsonObject, asJsonString, parseJsonObject } from "../web/src/lib/json.ts";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { containedRealpath, head, tailBytes } from "./journal/files.ts";
import type { ChatBody, ChatParams, LiveWindows } from "./journal/live.ts";
import type { JournalAdapter } from "./journal/types.ts";
import type { PaneWire, SnapshotResponse } from "./types.ts";

const RUN_ID = /^\d{8}T\d{6}-[A-Za-z0-9._-]{1,40}-[a-f0-9]{4}$/u;
const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu;
const DAY = 86_400_000;
type RunInfo = NonNullable<PaneWire["agentRun"]>;
interface Run extends RunInfo {
  name: string;
  agent: string;
  cwd: string;
  pane: string | null;
  explicitPane: boolean;
  workspace: string | null;
  session: string | null;
}

function boundPane(run: Run, panes: PaneWire[]) {
  // A reused pane with an interactive session keeps its own conversation.
  const shells = panes.filter(p => !p.hasSession &&
    (!run.workspace || run.workspace === p.workspaceId || run.workspace === p.workspaceLabel));
  // The old central notifier recorded the orchestrator's environment. That pane
  // can be stale. Use it only when its current folder corroborates the hint.
  const exact = shells.find(p => p.paneId === run.pane);
  if (run.explicitPane) return exact;
  const candidates = shells.filter(p => p.cwd === run.cwd);
  if (exact?.cwd === run.cwd) return exact;
  if (candidates.length === 1) return candidates[0];
  const named = candidates.filter(p => [p.paneLabel, p.tabLabel, p.soleTabName].some(label =>
    label && (run.name === label || run.name.startsWith(label + "-"))));
  return named.length === 1 ? named[0] : undefined;
}

export class AgentRuns {
  private listing?: { expires: number; rows: Promise<Run[]> };

  constructor(private dir: string, private stopRun: (id: string, dir: string) => Promise<boolean>) {}

  async read(id: string): Promise<Run | null> {
    if (!RUN_ID.test(id)) return null;
    const file = await containedRealpath(join(this.dir, id + ".status"), this.dir);
    if (!file) return null;
    try {
      const row = parseJsonObject(await head(file, 128 * 1024));
      if (!row || row.id !== id) return null;
      const name = asJsonString(row.name), agent = asJsonString(row.agent), cwd = asJsonString(row.cwd);
      const states = ["running", "done", "failed", "timeout", "orphaned"] as const;
      const status = states.find(state => state === row.status);
      const start = Date.parse(asJsonString(row.started_at) ?? asJsonString(row.created_at) ?? "");
      if (!name || !agent || !cwd || !status || !Number.isFinite(start)) return null;
      const central = asJsonObject(row.central);
      const pane = asJsonString(row.herdr_pane);
      // A recorded path is only a hint for its UUID. The journal adapter resolves
      // it afresh inside its own roots, including when an account changes.
      const journal = basename(asJsonString(row.journal) ?? "");
      const suffix = /([a-f0-9-]{36})\.jsonl$/iu.exec(journal)?.[1];
      return { id, name, agent, cwd, status, start, end: Date.parse(asJsonString(row.ended_at) ?? "") || null,
        pane: pane ?? asJsonString(central?.herdr_pane) ?? null, explicitPane: !!pane,
        workspace: asJsonString(row.herdr_workspace) ?? asJsonString(central?.herdr_workspace) ?? null,
        session: asJsonString(row.session_id) ?? suffix ?? null };
    } catch { return null; }
  }

  private async scan() {
    const names = await readdir(this.dir).catch(() => []);
    const rows: Run[] = [];
    for (const name of names) {
      if (!name.endsWith(".status")) continue;
      const run = await this.read(name.slice(0, -7));
      if (run && (run.status === "running" || (run.end ?? run.start) >= Date.now() - DAY)) rows.push(run);
    }
    return rows.toSorted((a, b) => b.start - a.start || b.id.localeCompare(a.id));
  }

  async attach(body: SnapshotResponse, primary: string) {
    if (!this.listing || Date.now() >= this.listing.expires) {
      this.listing = { expires: Date.now() + 3000, rows: this.scan() };
    }
    const panes = body.shellPanes.filter(p => !p.session || p.session === primary);
    const claimed = new Set<string>();
    for (const run of await this.listing.rows) {
      const pane = boundPane(run, panes);
      const agentRun = { id: run.id, status: run.status, start: run.start, end: run.end };
      if (pane && !claimed.has(pane.paneId)) {
        claimed.add(pane.paneId);
        Object.assign(pane, { agentRun, paneLabel: run.name });
        continue;
      }
      const workspace = body.workspaces.find(w => w.workspaceId === (pane?.workspaceId ?? run.workspace) || w.label === run.workspace);
      body.shellPanes.push({ paneId: "agent-run:" + run.id, paneLabel: run.name, agentRun,
        workspaceId: workspace?.workspaceId ?? "agent-runs", workspaceLabel: workspace?.label ?? "Agent runs",
        workspaceNumber: workspace?.number ?? 0, tabId: "", agent: run.agent, status: "unknown",
        kind: "shell", cwd: run.cwd, focused: false });
    }
  }

  async stop(id: string) {
    return (await this.read(id))?.status === "running" && await this.stopRun(id, this.dir);
  }

  async chat(id: string, adapters: Record<string, JournalAdapter>, live: LiveWindows, params: ChatParams): Promise<ChatBody | null> {
    const run = await this.read(id);
    if (!run) return null;
    const file = await containedRealpath(join(this.dir, id + ".log"), this.dir);
    const codex = run.agent === "codexp" || run.agent === "codex";
    const adapter = codex ? adapters.codex : ["claude", "claudep", "kimi", "glm"].includes(run.agent) ? adapters.claude : undefined;
    let session = run.session;
    if (!session && codex && file) {
      const header = (await head(file, 8192)).split(/^user\r?$/mu, 1)[0] ?? "";
      session = /^session id: ([\da-f-]+)\r?$/imu.exec(header)?.[1] ?? null;
    }
    if (session && UUID.test(session) && adapter) {
      const ref = { kind: "id" as const, value: session };
      const body = params.before ? await live.older(adapter, ref, params.before, params.limit, params.turns)
        : await live.window(adapter, ref, params);
      if (body) return body;
    }
    if (!file) return null;
    const log = await tailBytes(file, 32 * 1024);
    return { page: "live", session: "log-" + id, gen: 1, rev: Math.floor(log.mtimeMs), head: 1,
      oldest: 1, queued: [], hasOlder: false, upserts: [{ seq: 1, uuid: "output", ts: "", role: "assistant",
        parts: [{ kind: "text", text: log.text }] }] };
  }
}
