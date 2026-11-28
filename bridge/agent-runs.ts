import { asJsonNumber, asJsonObject, asJsonString, parseJsonObject } from "../web/src/lib/json.ts";
import { AgentRunTrash } from "./agent-run-trash.ts";
import type { BotAction } from "./bot-trash.ts";
import { randomUUID } from "node:crypto";
import { readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { containedRealpath, head, tailBytes } from "./journal/files.ts";
import type { ChatBody, ChatParams, LiveWindows } from "./journal/live.ts";
import type { JournalAdapter } from "./journal/types.ts";
import type { ActivityLedger } from "./activity.ts";
import type { MuxCreatedPane, MuxOutcome, MuxTabRequest } from "./mux/types.ts";
import type { PaneWire, SnapshotResponse } from "./types.ts";

const RUN_ID = /^\d{8}T\d{6}-[A-Za-z0-9._-]{1,40}-[a-f0-9]{4}$/u;
const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu;
const BOT = /^[a-z0-9-]+$/u;
const DAY = 86_400_000;
const IMPLEMENTATION_TIMEOUT = 3 * 60 * 60;
const MAX_ACTION_TEXT = 32_000;
const CLAUDE_AGENTS = new Set(["claude", "claudep", "kimi", "glm"]);
const SUPPORTED_AGENTS = new Set([...CLAUDE_AGENTS, "codex", "codexp"]);
// Separate from mux session names (which cannot contain NUL): a run survives
// a pane reassignment, and mux reconciliation only knows the physical panes.
const RUN_RECEIPTS = "\0agent-runs";
type RunInfo = NonNullable<PaneWire["agentRun"]>;
export interface Run extends RunInfo {
  name: string;
  agent: string;
  cwd: string;
  pane: string | null;
  explicitPane: boolean;
  workspace: string | null;
  session: string | null;
  journal: string | null;
  promptFile: string;
  bot: string | null;
  timeoutSeconds: number;
  envFiles: string[];
  continues: string | null;
}

export interface AgentRunProcessResult { code: number; stdout: string; stderr: string }
export type AgentRunProcess = (argv: readonly string[], env?: Record<string, string>) => Promise<AgentRunProcessResult>;
export interface AgentRunMux {
  waitReady(paneId: string): Promise<boolean>;
  createTab(request: MuxTabRequest): Promise<MuxOutcome<MuxCreatedPane>>;
}
export type AgentRunActionResult =
  | { ok: true; paneId: string | null; runId: string | null }
  | { ok: false; reason: "not-found" | "running" | "unavailable" | "busy" | "bad-request" | "launch-failed" };

function boundPane(run: Run, panes: PaneWire[]) {
  // A reused pane with an interactive session keeps its own conversation.
  const shells = panes.filter(p => !p.hasSession && !p.paneId.startsWith("agent-run:") &&
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

function resumable(run: Run): boolean {
  return SUPPORTED_AGENTS.has(run.agent) && run.bot !== null && BOT.test(run.bot) && run.cwd !== "";
}

function planRun(name: string, brief: string): boolean {
  if (/-impl$/iu.test(name)) return false;
  return /\bplan(?:ning)?\b/iu.test(name) || /\bplan(?:ning)?\b|no\s+(?:implementes|implementar)|s[óo]lo\s+plan|do\s+not\s+implement|plan\s+only/iu.test(brief);
}

function shellQuote(word: string): string {
  return `'${word.replaceAll("'", `'"'"'`)}'`;
}

function commandLine(argv: readonly string[], env: Record<string, string>): string {
  const assignments = Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`);
  return [...assignments, ...argv.map(shellQuote)].join(" ");
}

function rootOf(run: Run, rows: ReadonlyMap<string, Run>): string {
  const seen = new Set<string>();
  let current = run;
  while (current.continues !== null && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = rows.get(current.continues);
    if (!parent) break;
    current = parent;
  }
  return current.id;
}

export class AgentRuns {
  private readonly trash: AgentRunTrash;
  private trashLane = Promise.resolve();
  private sweeping?: Promise<void>;
  private listing?: { expires: number; rows: Promise<Run[]> };
  private panes: PaneWire[] = [];
  private readonly requests = new Map<string, { fingerprint: string; answer: Promise<AgentRunActionResult> }>();
  private readonly launching = new Map<string, Promise<AgentRunActionResult>>();

  constructor(private dir: string, private stopRun: (id: string, dir: string) => Promise<boolean>,
    private activity: ActivityLedger, private process?: AgentRunProcess, stateDir = dir,
    private purgeTerminal?: (terminalId: string) => Promise<void>) {
    this.trash = new AgentRunTrash(stateDir);
  }

  async read(id: string): Promise<Run | null> {
    if (!RUN_ID.test(id)) return null;
    const file = await containedRealpath(join(this.dir, id + ".status"), this.dir);
    if (!file) return null;
    try {
      const row = parseJsonObject(await head(file, 128 * 1024));
      if (!row || row.id !== id) return null;
      const name = asJsonString(row.name), agent = asJsonString(row.agent), cwd = asJsonString(row.cwd);
      const states = ["running", "done", "stopped", "failed", "timeout", "orphaned"] as const;
      const status = states.find(state => state === row.status);
      const start = Date.parse(asJsonString(row.started_at) ?? asJsonString(row.created_at) ?? "");
      if (!name || !agent || !cwd || !status || !Number.isFinite(start)) return null;
      const central = asJsonObject(row.central);
      const pane = asJsonString(row.herdr_pane);
      // A recorded path is only a hint for its UUID. The journal adapter resolves
      // it afresh inside its own roots, including when an account changes.
      const journalPath = asJsonString(row.journal) ?? null;
      const journal = basename(journalPath ?? "");
      const suffix = /([a-f0-9-]{36})\.jsonl$/iu.exec(journal)?.[1];
      const timeout = asJsonNumber(row.timeout_seconds);
      const envFiles = Array.isArray(row.env_files) ? row.env_files.map(asJsonString).filter((v): v is string => v !== undefined) : [];
      const linkFile = await containedRealpath(join(this.dir, id + ".collie.json"), this.dir);
      const link = linkFile ? parseJsonObject(await head(linkFile, 4096).catch(() => "")) : undefined;
      const linked = asJsonString(link?.continues);
      const briefFile = await containedRealpath(join(this.dir, id + ".prompt"), this.dir);
      const brief = briefFile ? await head(briefFile, 64 * 1024).catch(() => "") : "";
      return { id, name, agent, cwd, status, start, end: Date.parse(asJsonString(row.ended_at) ?? "") || null,
        pane: pane ?? asJsonString(central?.herdr_pane) ?? null, explicitPane: !!pane,
        workspace: asJsonString(row.herdr_workspace) ?? asJsonString(central?.herdr_workspace) ?? null,
        session: asJsonString(row.session_id) ?? suffix ?? null, journal: journalPath,
        promptFile: asJsonString(row.prompt_file) ?? join(this.dir, id + ".prompt"),
        bot: asJsonString(row.bot) ?? asJsonString(central?.bot) ?? null,
        timeoutSeconds: timeout !== undefined && Number.isFinite(timeout) && timeout > 0 ? Math.ceil(timeout) : 3600,
        envFiles, continues: linked && RUN_ID.test(linked) && linked !== id ? linked : null,
        rootId: id, canResume: false, plan: planRun(name, brief) };
    } catch { return null; }
  }

  private async scan() {
    this.activity.forgetSeenBefore(RUN_RECEIPTS, Date.now() - DAY);
    const names = await readdir(this.dir).catch(() => []);
    const rows: Run[] = [];
    for (const name of names) {
      if (!name.endsWith(".status")) continue;
      const run = await this.read(name.slice(0, -7));
      if (run) rows.push(run);
    }
    const byId = new Map(rows.map(row => [row.id, row]));
    for (const row of rows) {
      row.rootId = rootOf(row, byId);
      row.canResume = resumable(row);
    }
    const placements = this.trash.read();
    return rows.filter(run => run.status === "running" || (run.end ?? run.start) >= Date.now() - DAY || placements.has(run.rootId ?? run.id)).toSorted((a, b) => b.start - a.start || b.id.localeCompare(a.id));
  }

  async attach(body: SnapshotResponse, primary: string) {
    this.panes = [...body.shellPanes];
    if (!this.listing || Date.now() >= this.listing.expires) {
      this.listing = { expires: Date.now() + 3000, rows: this.scan() };
    }
    const panes = body.shellPanes.filter(p => !p.session || p.session === primary);
    const claimed = new Set<string>();
    const rows = await this.listing.rows;
    const placements = this.trash.read();
    const parents = new Set(rows.map(row => row.continues).filter(id => id !== null));
    for (const run of rows) {
      if (parents.has(run.id)) continue;
      const pane = boundPane(run, panes);
      const rootId = run.rootId ?? run.id;
      const placement = placements.get(rootId);
      if (placement && (placement.purged || placement.trashedAt !== null)) {
        // Hide only the shell this run currently owns; an interactive replacement never binds.
        if (pane?.terminalId && pane.terminalId === placement.terminalId && !claimed.has(pane.paneId)) {
          claimed.add(pane.paneId);
          body.shellPanes = body.shellPanes.filter(p => p !== pane);
        }
        if (placement.purged) continue;
        if (this.trash.expired(placement)) {
          await this.botAction(run.id, "purge", body, primary, undefined, placement.trashedAt ?? undefined).catch(() => undefined);
          continue;
        }
      }
      const agentRun = { id: run.id, rootId, status: run.status, start: run.start, end: run.end,
        name: run.name, harness: run.agent, canResume: run.canResume, plan: run.plan };
      const times = { lastActiveAt: run.end ?? run.start, lastSeenAt: this.activity.get(RUN_RECEIPTS, rootId)?.seenAt ?? 0 };
      if (pane && !placement && !claimed.has(pane.paneId)) {
        claimed.add(pane.paneId);
        Object.assign(pane, times, { agentRun, paneLabel: run.name });
        continue;
      }
      const workspace = body.workspaces.find(w => placement ? w.workspaceId === placement.workspace
        : w.workspaceId === (pane?.workspaceId ?? run.workspace) || w.label === run.workspace);
      if (pane?.terminalId && placement && pane.terminalId === placement.terminalId && !claimed.has(pane.paneId)) {
        claimed.add(pane.paneId);
        body.shellPanes = body.shellPanes.filter(p => p !== pane);
      }
      const virtual: PaneWire = { paneId: "agent-run:" + rootId, session: primary, paneLabel: run.name, agentRun, ...times,
        workspaceId: workspace?.workspaceId ?? "agent-runs", workspaceLabel: workspace?.label ?? "Agent runs",
        workspaceNumber: workspace?.number ?? 0, tabId: "", agent: run.agent, status: "unknown",
        kind: "shell", cwd: run.cwd, focused: false };
      if (placement?.trashedAt != null) virtual.trash = { originalWorkspaceId: placement.workspace, trashedAt: placement.trashedAt };
      body.shellPanes.push(virtual);
    }
  }

  botAction(id: string, action: BotAction, body: SnapshotResponse, primary: string, workspaceId?: string, trashedAt?: number): Promise<void> {
    const work = this.trashLane.then(async () => {
      const rows = await this.scan();
      const run = rows.find(row => row.id === id);
      if (!run) throw new Error("El chat ya no está disponible.");
      const root = run.rootId ?? run.id;
      if (rows.some(row => row.rootId === root && this.launching.has(row.id))) throw new Error("El bot está iniciando otra tarea. Vuelve a intentar.");
      const placement = this.trash.read().get(root);
      const pane = boundPane(run, body.shellPanes.filter(p => !p.session || p.session === primary));
      const original = body.workspaces.find(w => w.workspaceId === (pane?.workspaceId ?? run.workspace) || w.label === run.workspace);
      const current = placement?.workspace ?? original?.workspaceId ?? "agent-runs";
      if (action === "move" || action === "restore") {
        const destination = workspaceId ?? current;
        if (destination !== "agent-runs" && !body.workspaces.some(w => w.workspaceId === destination)) {
          throw new Error("Elige un workspace disponible.");
        }
        if (action === "move" && !workspaceId) throw new Error("Elige un workspace disponible.");
      }
      if (action === "purge") {
        if (!placement || placement.purged || placement.trashedAt === null || placement.trashedAt !== trashedAt) {
          throw new Error("La selección de Papelera ha cambiado.");
        }
        for (const member of rows.filter(row => row.rootId === root && row.status === "running")) {
          if (!await this.stopRun(member.id, this.dir)) throw new Error("No se pudo detener el bot.");
        }
        if (placement.terminalId) await this.purgeTerminal?.(placement.terminalId);
      }
      this.trash.act(root, action, current, workspaceId, trashedAt, pane?.terminalId);
      this.listing = undefined;
      return;
    });
    this.trashLane = work.catch(() => undefined);
    return work;
  }

  /** Expiry also runs while every browser is closed. Failed stops remain pending for retry. */
  sweepTrash(): Promise<void> {
    return this.sweeping ??= this.sweepExpiredTrash().finally(() => { this.sweeping = undefined; });
  }

  private async sweepExpiredTrash() {
    const expired = [...this.trash.read()].filter(([, row]) => !row.purged && this.trash.expired(row));
    if (!expired.length) return;
    const rows = await this.scan();
    const body: SnapshotResponse = { bridge: "connected", agents: [], shellPanes: [], workspaces: [], tabs: [], sessions: [], ts: 0 };
    for (const [id, placement] of expired) {
      const run = rows.find(row => row.rootId === id);
      if (!run) continue;
      try {
        await this.botAction(run.id, "purge", body, "", undefined, placement.trashedAt ?? undefined);
      } catch (error) {
        console.warn("[agent-run-trash] pending purge will retry", id, error instanceof Error ? error.message : "unknown error");
      }
    }
  }

  async stop(id: string) {
    return (await this.read(id))?.status === "running" && await this.stopRun(id, this.dir);
  }

  private async chatOne(run: Run, adapters: Record<string, JournalAdapter>, live: LiveWindows,
    params: ChatParams): Promise<ChatBody | null> {
    const file = await containedRealpath(join(this.dir, run.id + ".log"), this.dir);
    const codex = run.agent === "codexp" || run.agent === "codex";
    const adapter = codex ? adapters.codex : CLAUDE_AGENTS.has(run.agent) ? adapters.claude : undefined;
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
    return { page: "live", session: "log-" + run.id, gen: 1, rev: Math.floor(log.mtimeMs), head: 1,
      oldest: 1, queued: [], hasOlder: false, upserts: [{ seq: 1, uuid: "output", ts: "", role: "assistant",
        parts: [{ kind: "text", text: log.text }] }] };
  }

  async chat(id: string, adapters: Record<string, JournalAdapter> | null, live: LiveWindows | null,
    params: ChatParams, seen: boolean): Promise<ChatBody | null> {
    const original = await this.read(id);
    if (!original) return null;
    const rows = await this.scan();
    const byId = new Map(rows.map(row => [row.id, row]));
    const root = byId.get(rootOf(original, byId)) ?? original;
    const chain: Run[] = [];
    const seenIds = new Set<string>();
    let cursor: Run | undefined = root;
    while (cursor && !seenIds.has(cursor.id)) {
      chain.push(cursor);
      seenIds.add(cursor.id);
      cursor = rows.find(row => row.continues === cursor?.id);
    }
    const current = chain.at(-1) ?? original;
    if (seen && current.status !== "running" && (this.activity.get(RUN_RECEIPTS, root.id)?.seenAt ?? 0) < (current.end ?? current.start)) {
      this.activity.noteSeen(RUN_RECEIPTS, root.id);
    }
    if (!adapters || !live) return null;
    const bodies: { run: Run; body: ChatBody }[] = [];
    // Native Claude resume keeps appending to the parent's session. The newest link therefore already
    // contains every earlier link; reading both would draw the whole conversation twice.
    const readable = chain.filter((run, index) => {
      const next = chain[index + 1];
      return !next || run.session === null || run.agent !== next.agent || run.session !== next.session;
    });
    for (const run of readable) {
      const body = await this.chatOne(run, adapters, live, params);
      if (body) bodies.push({ run, body });
    }
    if (bodies.length === 0) return null;
    if (bodies.length === 1) return bodies[0]!.body;
    if (params.before) return bodies.at(-1)!.body;
    const liveBodies = bodies.filter((entry): entry is { run: Run; body: Extract<ChatBody, { page: "live" }> } => entry.body.page === "live");
    if (liveBodies.length === 0) return null;
    let seq = 1_000_000;
    const upserts = liveBodies.flatMap(({ run, body }) => body.upserts.map(entry => ({ ...entry, seq: seq++, uuid: run.id + ":" + entry.uuid })));
    const first = liveBodies[0]!.body, last = liveBodies.at(-1)!.body;
    return { ...last, session: "agent-run-" + root.id, gen: liveBodies.reduce((n, entry) => n + entry.body.gen, 0),
      rev: Math.max(...liveBodies.map(entry => entry.body.rev)), head: seq - 1, oldest: 1_000_000,
      hasOlder: first.hasOlder, upserts };
  }

  private action(id: string, requestId: string, fingerprint: string,
    start: () => Promise<AgentRunActionResult>): Promise<AgentRunActionResult> {
    const earlier = this.requests.get(requestId);
    if (earlier) return earlier.fingerprint === fingerprint ? earlier.answer : Promise.resolve({ ok: false, reason: "bad-request" });
    const active = this.launching.get(id);
    if (active) return active.then(() => ({ ok: false, reason: "busy" }));
    const answer = this.trashLane.then(async (): Promise<AgentRunActionResult> => {
      const run = (await this.scan()).find(row => row.id === id);
      const placement = run && this.trash.read().get(run.rootId ?? run.id);
      if (placement && (placement.purged || placement.trashedAt !== null)) return { ok: false, reason: "unavailable" };
      return start();
    }).finally(() => {
      if (this.launching.get(id) === answer) this.launching.delete(id);
    });
    this.launching.set(id, answer);
    this.requests.set(requestId, { fingerprint, answer });
    return answer;
  }

  async resume(id: string, text: string, requestId: string, mux: AgentRunMux): Promise<AgentRunActionResult> {
    const clean = text.trim();
    if (!clean || clean.length > MAX_ACTION_TEXT || !requestId) return { ok: false, reason: "bad-request" };
    return this.action(id, requestId, `resume:${id}:${clean}`, async () => {
      const run = await this.read(id);
      if (!run) return { ok: false, reason: "not-found" };
      if (run.status === "running") return { ok: false, reason: "running" };
      if (!resumable(run) || !this.process) return { ok: false, reason: "unavailable" };
      try {
        await stat(run.cwd);
      } catch { return { ok: false, reason: "unavailable" }; }
      const native = CLAUDE_AGENTS.has(run.agent) && run.session !== null && UUID.test(run.session) && run.journal !== null &&
        await stat(run.journal).then(info => info.isFile()).catch(() => false);
      const prompt = native ? `Continuación de ${id}. Instrucción nueva de Janez:\n\n${clean}\n` :
        await this.fallbackPrompt(run, `Continuación de ${id}. Instrucción nueva de Janez:\n\n${clean}`);
      const before = new Set((await readdir(this.dir).catch(() => [])).filter(name => name.endsWith(".status")));
      const promptFile = await this.writePrompt(id, "resume", prompt);
      const candidate = boundPane(run, this.panes);
      const pane = candidate && await mux.waitReady(candidate.paneId).catch(() => false) ? candidate : undefined;
      const argv = this.argv(run, promptFile, run.name, run.timeoutSeconds, "continuación desde Collie",
        pane?.paneId ?? null, pane?.workspaceId ?? run.workspace, native ? ["--resume", run.session!] : []);
      const launched = await this.launch(argv, run.envFiles, pane?.paneId);
      if (launched.code !== 0) return { ok: false, reason: "launch-failed" };
      const child = pane ? await this.findNewRun(before, promptFile) : this.runId(launched.stdout);
      if (child) await this.link(child, id);
      this.listing = undefined;
      return { ok: true, paneId: pane?.paneId ?? null, runId: child };
    });
  }

  async implement(id: string, text: string, requestId: string, agent: string, effort: string, mux: AgentRunMux): Promise<AgentRunActionResult> {
    const clean = text.trim();
    if (clean.length > MAX_ACTION_TEXT || !requestId || !SUPPORTED_AGENTS.has(agent) || !/^(?:low|medium|high|xhigh|max)$/u.test(effort))
      return { ok: false, reason: "bad-request" };
    return this.action(id, requestId, `implement:${id}:${agent}:${effort}:${clean}`, async () => {
      const run = await this.read(id);
      if (!run) return { ok: false, reason: "not-found" };
      if (run.status === "running") return { ok: false, reason: "running" };
      if (!run.plan) return { ok: false, reason: "unavailable" };
      if (!resumable({ ...run, agent }) || !this.process) return { ok: false, reason: "unavailable" };
      try {
        await stat(run.cwd);
      } catch { return { ok: false, reason: "unavailable" }; }
      const name = run.name.slice(0, 65) + "-impl";
      const instructions = clean ? `\n\nInstrucciones extra de Janez:\n${clean}` : "";
      const prompt = await this.fallbackPrompt(run, `Implementa el plan «${run.name}» (${id}).\n` +
        `Brief original del plan: ${run.promptFile}\n` +
        `El documento de plan, si el brief o el resultado lo nombran, es la fuente principal. El log anterior es ${join(this.dir, id + ".log")}.\n` +
        "Crea una rama nueva, abre un PR y no uses force push. No hagas operaciones destructivas en bases de datos ni imprimas secretos." + instructions);
      const workspace = run.workspace;
      if (!workspace) return { ok: false, reason: "unavailable" };
      const created = await mux.createTab({ spaceId: workspace, label: name, cwd: run.cwd });
      if (!created.ok) return { ok: false, reason: "launch-failed" };
      if (!await mux.waitReady(created.value.paneId).catch(() => false)) return { ok: false, reason: "launch-failed" };
      const promptFile = await this.writePrompt(id, "implement", prompt);
      const extra = agent === "codex" || agent === "codexp" ? ["-c", `model_reasoning_effort=${effort}`] : ["--effort", effort];
      const argv = this.argv({ ...run, agent }, promptFile, name, Math.max(run.timeoutSeconds, IMPLEMENTATION_TIMEOUT),
        "implementación de plan desde Collie", created.value.paneId, created.value.spaceId, extra);
      const launched = await this.launch(argv, run.envFiles, created.value.paneId);
      if (launched.code !== 0) return { ok: false, reason: "launch-failed" };
      this.listing = undefined;
      return { ok: true, paneId: created.value.paneId, runId: null };
    });
  }

  /** A fresh interactive bot, even when the old run has no resumable session or notifier. */
  async newChat(id: string, text: string, requestId: string, workspaceId: string, mux: AgentRunMux): Promise<AgentRunActionResult> {
    const clean = text.trim();
    if (clean.length > MAX_ACTION_TEXT || !requestId || !workspaceId || workspaceId === "agent-runs")
      return { ok: false, reason: "bad-request" };
    return this.action(id, requestId, `new-chat:${id}:${workspaceId}:${clean}`, async () => {
      const run = await this.read(id);
      if (!run) return { ok: false, reason: "not-found" };
      if (run.status === "running") return { ok: false, reason: "running" };
      if (!SUPPORTED_AGENTS.has(run.agent) || !this.process) return { ok: false, reason: "unavailable" };
      if (!await stat(run.cwd).then(info => info.isDirectory()).catch(() => false))
        return { ok: false, reason: "unavailable" };
      const prompt = await this.fallbackPrompt(run,
        `Este es un bot nuevo que recibe el contexto del bot «${run.name}» (${id}).\n` +
        "Empieza con un resumen breve del objetivo, decisiones, trabajo terminado y pendientes. " +
        "El brief y el resultado anteriores son contexto histórico, no una orden de repetir tareas ya terminadas.\n" +
        (clean ? `Después atiende esta instrucción nueva del usuario:\n${clean}` :
          "Después del resumen, espera las instrucciones del usuario."));
      const promptFile = await this.writePrompt(id, "new-chat", prompt);
      const created = await mux.createTab({ spaceId: workspaceId, label: run.name.slice(0, 65) + "-chat", cwd: run.cwd });
      if (!created.ok || !await mux.waitReady(created.value.paneId).catch(() => false))
        return { ok: false, reason: "launch-failed" };
      // Start the recorded wrapper interactively, without --resume or the old run's supervisor.
      // The private handoff file keeps terminal command length bounded and its contents out of argv.
      const command = commandLine([run.agent, `Lee el contexto de ${promptFile} y sigue sus instrucciones.`], {});
      const launched = await this.process(["herdr", "pane", "run", created.value.paneId, command]).catch(() => null);
      if (!launched || launched.code !== 0) return { ok: false, reason: "launch-failed" };
      return { ok: true, paneId: created.value.paneId, runId: null };
    });
  }

  private argv(run: Run, promptFile: string, name: string, timeout: number, reason: string,
    pane: string | null, workspace: string | null, extra: string[]): string[] {
    const argv = ["agent-run", "--runs-dir", this.dir, "--bot", run.bot!, "--name", name,
      "--timeout", `${timeout}s`, "--reason", reason];
    if (pane) argv.push("--pane", pane);
    if (workspace) argv.push("--workspace", workspace);
    argv.push(run.agent, promptFile, run.cwd);
    if (extra.length) argv.push("--", ...extra);
    return argv;
  }

  private async launch(argv: readonly string[], envFiles: string[], pane: string | undefined): Promise<AgentRunProcessResult> {
    if (!this.process) return { code: 1, stdout: "", stderr: "no process" };
    const env: Record<string, string> = {};
    if (envFiles.length) env.AGENT_RUN_ENV_FILES = envFiles.join(":");
    try {
      if (!pane) return await this.process(argv, env);
      return await this.process(["herdr", "pane", "run", pane, commandLine(argv, env)]);
    } catch (error) {
      // A missing executable must read as a failed launch (502), never as an unhandled 500.
      return { code: 127, stdout: "", stderr: error instanceof Error ? error.message : "spawn failed" };
    }
  }

  private async writePrompt(id: string, kind: string, text: string): Promise<string> {
    const file = join(this.dir, `${id}.${kind}-${randomUUID()}.prompt`);
    await writeFile(file, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return file;
  }

  private async fallbackPrompt(run: Run, instruction: string): Promise<string> {
    const file = await containedRealpath(join(this.dir, run.id + ".log"), this.dir);
    const briefFile = await containedRealpath(run.promptFile, this.dir);
    const brief = briefFile ? await head(briefFile, 64 * 1024).catch(() => "") : "";
    const tail = file ? await tailBytes(file, 128 * 1024).then(log => log.text.split("\n").slice(-200).join("\n")).catch(() => "") : "";
    return `${instruction}\n\nBrief original (${run.promptFile}):\n${brief || "(sin brief disponible)"}\n` +
      `Resultado anterior: ${join(this.dir, run.id + ".log")}\n` +
      `Últimas líneas del resultado anterior:\n${tail || "(sin log disponible)"}\n`;
  }

  private runId(stdout: string): string | null {
    const id = stdout.trim().split(/\s+/u).find(word => RUN_ID.test(word));
    return id ?? null;
  }

  private async findNewRun(before: ReadonlySet<string>, promptFile: string): Promise<string | null> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const names = await readdir(this.dir).catch(() => []);
      for (const name of names) {
        if (!name.endsWith(".status") || before.has(name)) continue;
        const run = await this.read(name.slice(0, -7));
        if (run?.promptFile === promptFile) return run.id;
      }
      await Bun.sleep(100);
    }
    return null;
  }

  private async link(child: string, parent: string): Promise<void> {
    if (!RUN_ID.test(child) || !RUN_ID.test(parent)) return;
    await writeFile(join(this.dir, child + ".collie.json"), JSON.stringify({ version: 1, continues: parent }),
      { encoding: "utf8", mode: 0o600 });
  }
}
