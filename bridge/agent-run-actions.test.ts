import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodeProcess from "node:process";
import { join } from "node:path";
import { ActivityLedger } from "./activity.ts";
import { AgentRuns, type AgentRunMux, type AgentRunProcess } from "./agent-runs.ts";
import { loadConfig } from "./config.ts";
import { LiveWindows } from "./journal/live.ts";
import { TranscriptStore } from "./journal/store.ts";
import { muxOk } from "./mux/types.ts";
import { filePairingIo, PairingStore } from "./pairing.ts";
import { guard } from "./server.ts";
import type { SnapshotResponse } from "./types.ts";

const PARENT = "20261126T150000-plan-abcd";
const CHILD = "20261126T150100-cont-beef";
const SID = "11111111-2222-4444-8888-999999999999";
const REQ1 = "11111111-1111-4111-8111-111111111111";
const REQ2 = "22222222-2222-4222-8222-222222222222";

interface Recorded { tool: string; argv: string[]; envFiles: string | null }

async function records(file: string): Promise<Recorded[]> {
  const text = await readFile(file, "utf8").catch(() => "");
  // SAFETY: the two fixture scripts above this file write exactly this JSON shape, one per line.
  return text.trim() === "" ? [] : text.trim().split("\n").map(line => JSON.parse(line) as Recorded);
}

async function fixture(agent = "kimi") {
  const root = await mkdtemp(join(tmpdir(), "collie-agent-actions-"));
  const dir = join(root, "runs"), bin = join(root, "bin"), record = join(root, "calls.jsonl");
  const cwd = join(root, "work space");
  await Promise.all([mkdir(dir), mkdir(bin), mkdir(cwd)]);
  const agentScript = `#!/usr/bin/env bun
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const argv = Bun.argv.slice(2);
await appendFile(process.env.RECORD!, JSON.stringify({ tool: "agent-run", argv, envFiles: process.env.AGENT_RUN_ENV_FILES ?? null }) + "\\n");
const take = (flag) => { const i = argv.indexOf(flag); return i < 0 ? null : argv[i + 1]; };
const dir = take("--runs-dir")!;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--") break;
  if (["--runs-dir", "--bot", "--name", "--timeout", "--reason", "--pane", "--workspace"].includes(argv[i])) { i++; continue; }
  positional.push(argv[i]);
}
const id = "${CHILD}";
await writeFile(join(dir, id + ".status"), JSON.stringify({ id, name: take("--name"), agent: positional[0], prompt_file: positional[1], cwd: positional[2],
  created_at: new Date().toISOString(), status: "running", herdr_pane: take("--pane"), herdr_workspace: take("--workspace"), bot: take("--bot"), timeout_seconds: 3600 }));
await writeFile(join(dir, id + ".log"), "respuesta de continuación\\n");
console.log(id);
`;
  const herdrScript = `#!/usr/bin/env bun
import { appendFile } from "node:fs/promises";
const argv = Bun.argv.slice(2);
await appendFile(process.env.RECORD!, JSON.stringify({ tool: "herdr", argv, envFiles: null }) + "\\n");
if (argv[0] === "pane" && argv[1] === "run") {
  const child = Bun.spawn(["/bin/bash", "-c", argv[3]!], { env: process.env, stdout: "inherit", stderr: "inherit" });
  process.exit(await child.exited);
}
`;
  await Promise.all([writeFile(join(bin, "agent-run"), agentScript), writeFile(join(bin, "herdr"), herdrScript)]);
  await Promise.all([chmod(join(bin, "agent-run"), 0o755), chmod(join(bin, "herdr"), 0o755)]);
  const process: AgentRunProcess = async (argv, extraEnv = {}) => {
    const child = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...nodeProcess.env, PATH: bin + ":" + nodeProcess.env.PATH, RECORD: record, ...extraEnv } });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, stdout, stderr };
  };
  const source = new AgentRuns(dir, async () => false, new ActivityLedger({ stateDir: root }), process);
  const status = { id: PARENT, name: "plan-sync-bnc-nexo", agent, cwd, created_at: new Date(Date.now() - 60_000).toISOString(),
    ended_at: new Date().toISOString(), status: "done", herdr_pane: null, herdr_workspace: "w1", bot: "api-bnc", timeout_seconds: 5400,
    prompt_file: join(dir, PARENT + ".prompt"), env_files: [join(root, "token.env")] };
  await Promise.all([writeFile(join(dir, PARENT + ".status"), JSON.stringify(status)),
    writeFile(join(dir, PARENT + ".prompt"), "Prepara un plan. No implementes."),
    writeFile(join(dir, PARENT + ".log"), "resultado previo\n")]);
  const mux: AgentRunMux = { waitReady: async () => true,
    createTab: async request => muxOk({ paneId: "w1:p9", spaceId: request.spaceId, spaceLabel: "Workspace", tabId: "w1:t9", cwd: request.cwd ?? cwd }) };
  return { root, dir, record, cwd, source, process, status, mux };
}

async function cleanup(root: string) {
  await rm(root, { recursive: true, force: true });
}

test("resume reuses a free pane, preserves native Claude session and quotes every shell word", async () => {
  const f = await fixture("kimi");
  const marker = join(f.root, "PWNED");
  try {
    const journal = join(f.root, "journal.jsonl");
    const name = `plan $(touch ${marker})`;
    await Promise.all([writeFile(journal, "{}\n"),
      writeFile(join(f.dir, PARENT + ".status"), JSON.stringify({ ...f.status, name, herdr_pane: "w1:p1", session_id: SID, journal }))]);
    // SAFETY: attach needs only these pane and workspace fields to bind the run's recorded pane.
    const body = { workspaces: [{ workspaceId: "w1", label: "Workspace" }],
      shellPanes: [{ paneId: "w1:p1", cwd: f.cwd, kind: "shell", workspaceId: "w1", workspaceLabel: "Workspace" }] } as SnapshotResponse;
    await f.source.attach(body, "default");
    const answer = await f.source.resume(PARENT, "Ajusta el alcance; no ejecutes $(touch " + marker + ")", REQ1, f.mux);
    expect(answer).toEqual({ ok: true, paneId: "w1:p1", runId: CHILD });
    const calls = await records(f.record);
    expect(calls.map(call => call.tool)).toEqual(["herdr", "agent-run"]);
    const argv = calls[1]!.argv;
    expect(argv.slice(0, 12)).toEqual(["--runs-dir", f.dir, "--bot", "api-bnc", "--name", name, "--timeout", "5400s",
      "--reason", "continuación desde Collie", "--pane", "w1:p1"]);
    expect(argv.slice(12, 16)).toEqual(["--workspace", "w1", "kimi", expect.stringMatching(/\.resume-.*\.prompt$/u)]);
    expect(argv.slice(15)).toEqual([expect.stringMatching(/\.resume-.*\.prompt$/u), f.cwd, "--", "--resume", SID]);
    expect(calls[1]!.envFiles).toBe(join(f.root, "token.env"));
    const promptFile = argv[15]!;
    const prompt = await readFile(promptFile, "utf8");
    expect(prompt).toContain(`Continuación de ${PARENT}. Instrucción nueva de Janez:`);
    expect(prompt).toContain("Ajusta el alcance");
    expect((await stat(promptFile)).mode & 0o777).toBe(0o600);
    expect(await stat(marker).catch(() => null)).toBeNull();
    expect(JSON.parse(await readFile(join(f.dir, CHILD + ".collie.json"), "utf8"))).toEqual({ version: 1, continues: PARENT });
    // SAFETY: the projection mutates only agentRun and may append a virtual pane to these fixture fields.
    const after = { workspaces: body.workspaces, shellPanes: [...body.shellPanes] } as SnapshotResponse;
    await f.source.attach(after, "default");
    expect(after.shellPanes.filter(pane => pane.agentRun).map(pane => [pane.paneId, pane.agentRun?.id])).toEqual([["w1:p1", CHILD]]);
  } finally { await cleanup(f.root); }
});

test("Codex uses context fallback and a detached continuation stays in the root virtual thread", async () => {
  const f = await fixture("codexp");
  try {
    const answer = await f.source.resume(PARENT, "Resume con este ajuste", REQ1, f.mux);
    expect(answer).toEqual({ ok: true, paneId: null, runId: CHILD });
    const [call] = await records(f.record);
    expect(call!.tool).toBe("agent-run");
    expect(call!.argv.slice(0, 10)).toEqual(["--runs-dir", f.dir, "--bot", "api-bnc", "--name", "plan-sync-bnc-nexo", "--timeout", "5400s", "--reason", "continuación desde Collie"]);
    expect(call!.argv).not.toContain("--resume");
    expect(call!.argv[12]).toBe("codexp");
    const prompt = await readFile(call!.argv[13]!, "utf8");
    expect(prompt).toContain("Brief original (" + join(f.dir, PARENT + ".prompt") + "):");
    expect(prompt).toContain("Prepara un plan. No implementes.");
    expect(prompt).toContain("resultado previo");
    expect(prompt).toContain("Resume con este ajuste");
    // SAFETY: attach consumes only these optional snapshot collections and creates virtual panes when none exist.
    const body = { workspaces: [{ workspaceId: "w1", label: "Workspace" }], shellPanes: new Array<SnapshotResponse["shellPanes"][number]>() } as SnapshotResponse;
    await f.source.attach(body, "default");
    expect(body.shellPanes.map(pane => [pane.paneId, pane.agentRun?.id, pane.agentRun?.rootId])).toEqual([["agent-run:" + PARENT, CHILD, PARENT]]);
    const chat = await f.source.chat(PARENT, {}, new LiveWindows(new TranscriptStore()), { limit: 20 }, false);
    expect(chat?.page).toBe("live");
    if (chat?.page !== "live") throw new Error("live chat expected");
    expect(chat.upserts.map(entry => entry.parts[0])).toEqual([{ kind: "text", text: "resultado previo\n" }, { kind: "text", text: "respuesta de continuación\n" }]);
  } finally { await cleanup(f.root); }
});

test("Implement opens a sibling tab, enforces three hours and writes the implementation brief", async () => {
  const f = await fixture("codexp");
  try {
    const tabs: unknown[] = [];
    const mux: AgentRunMux = { ...f.mux, createTab: async request => {
      tabs.push(request);
      return f.mux.createTab(request);
    } };
    const answer = await f.source.implement(PARENT, "Usa una rama pequeña", REQ1, "claudep", "max", mux);
    expect(answer).toEqual({ ok: true, paneId: "w1:p9", runId: null });
    expect(tabs).toEqual([{ spaceId: "w1", label: "plan-sync-bnc-nexo-impl", cwd: f.cwd }]);
    const calls = await records(f.record);
    const argv = calls[1]!.argv;
    expect(argv.slice(0, 12)).toEqual(["--runs-dir", f.dir, "--bot", "api-bnc", "--name", "plan-sync-bnc-nexo-impl", "--timeout", "10800s",
      "--reason", "implementación de plan desde Collie", "--pane", "w1:p9"]);
    expect(argv.slice(12, 16)).toEqual(["--workspace", "w1", "claudep", expect.stringMatching(/\.implement-.*\.prompt$/u)]);
    expect(argv.slice(-3)).toEqual(["--", "--effort", "max"]);
    const prompt = await readFile(argv[15]!, "utf8");
    expect(prompt).toContain("Implementa el plan «plan-sync-bnc-nexo»");
    expect(prompt).toContain("Crea una rama nueva, abre un PR y no uses force push");
    expect(prompt).toContain("Usa una rama pequeña");
    expect(prompt).toContain("resultado previo");
    expect(await stat(join(f.dir, CHILD + ".collie.json")).catch(() => null)).toBeNull();
  } finally { await cleanup(f.root); }
});

test("an occupied original pane is never reused for a continuation", async () => {
  const f = await fixture("codexp");
  try {
    await writeFile(join(f.dir, PARENT + ".status"), JSON.stringify({ ...f.status, herdr_pane: "w1:p1" }));
    // SAFETY: attach needs only these pane and workspace fields to consider the recorded original pane.
    const body = { workspaces: [{ workspaceId: "w1", label: "Workspace" }],
      shellPanes: [{ paneId: "w1:p1", cwd: f.cwd, kind: "shell", workspaceId: "w1", workspaceLabel: "Workspace" }] } as SnapshotResponse;
    await f.source.attach(body, "default");
    const answer = await f.source.resume(PARENT, "Continúa sin tocar el pane", REQ1, { ...f.mux, waitReady: async () => false });
    expect(answer).toMatchObject({ ok: true, paneId: null, runId: CHILD });
    const calls = await records(f.record);
    expect(calls.map(call => call.tool)).toEqual(["agent-run"]);
    expect(calls[0]!.argv).not.toContain("--pane");
  } finally { await cleanup(f.root); }
});

test("a running or unsupported run is refused without spawning", async () => {
  const f = await fixture("unknown-agent");
  try {
    await writeFile(join(f.dir, PARENT + ".status"), JSON.stringify({ ...f.status, status: "running" }));
    expect(await f.source.resume(PARENT, "No lances", REQ1, f.mux)).toEqual({ ok: false, reason: "running" });
    await writeFile(join(f.dir, PARENT + ".status"), JSON.stringify({ ...f.status, status: "done" }));
    expect(await f.source.resume(PARENT, "No lances", REQ2, f.mux)).toEqual({ ok: false, reason: "unavailable" });
    expect(await records(f.record)).toEqual([]);
  } finally { await cleanup(f.root); }
});

test("one request replays while a different concurrent request cannot double-launch", async () => {
  const f = await fixture("codexp");
  let release = () => {};
  try {
    const gate = new Promise<void>(resolve => { release = resolve; });
    const delayed: AgentRunProcess = async (argv, env) => { await gate; return f.process(argv, env); };
    const source = new AgentRuns(f.dir, async () => false, new ActivityLedger({ stateDir: f.root }), delayed);
    const first = source.resume(PARENT, "Una sola continuación", REQ1, f.mux);
    const replay = source.resume(PARENT, "Una sola continuación", REQ1, f.mux);
    const second = source.resume(PARENT, "Otra continuación simultánea", REQ2, f.mux);
    release();
    expect(await first).toMatchObject({ ok: true, runId: CHILD });
    expect(await replay).toMatchObject({ ok: true, runId: CHILD });
    expect(await second).toEqual({ ok: false, reason: "busy" });
    expect((await records(f.record)).filter(call => call.tool === "agent-run")).toHaveLength(1);
  } finally {
    release();
    await cleanup(f.root);
  }
});

test("the resume write route refuses a request without a paired credential", async () => {
  const root = await mkdtemp(join(tmpdir(), "collie-agent-run-auth-"));
  try {
    const store = new PairingStore(filePairingIo(root));
    const cfg = loadConfig({ HOME: root });
    const req = new Request("http://127.0.0.1:8787/api/pane/agent-run%3A" + PARENT + "/resume", {
      method: "POST", headers: { host: "127.0.0.1:8787" }, body: JSON.stringify({ text: "hola", requestId: REQ1 }) });
    const denied = guard(req, cfg, "write", store);
    expect(denied?.status).toBe(403);
    expect(await denied?.text()).toBe("device not paired");
  } finally { await cleanup(root); }
});
