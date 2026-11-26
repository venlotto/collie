import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotAutoName, shortBotName, workTitle } from "./bot-auto-name.ts";
import type { AgentView } from "./types.ts";

describe("shortBotName", () => {
  test.each([
    ["Domino tiles display issue", "Domino tiles"],
    ["Nombre por defecto del bot", "Nombre defecto"],
    ["Auditoría W2 tesorería, paquetes y caja", "Auditoría W2"],
    ["Ventanas de bots en escritorio", "Ventanas bots"],
    ["W3 depósitos", "W3 depósitos"],
    ["the onboarding", "Onboarding"],
    ["OpenTelemetry stack setup with core correlations", "OpenTelemetry stack"],
    ["Internacionalización de configuraciones", "Internacionalización"],
  ])("%s → %s", (title, name) => expect(shortBotName(title)).toBe(name));

  test("a title with no word names nothing", () => {
    expect(shortBotName("123 · ~/repos")).toBeUndefined();
    expect(shortBotName("de la")).toBeUndefined();
  });
});

describe("workTitle", () => {
  const base = { agent: "codex", cwd: "/home/u/repos" } as const;
  test("the agent's own title wins", () => expect(workTitle({ ...base, agentTitle: "Fix login" })).toBe("Fix login"));
  test("codex: terminal title without the folder suffix", () =>
    expect(workTitle({ ...base, terminalTitle: "Organiza agentes para Collie | repos" })).toBe("Organiza agentes para Collie"));
  test("codex before the first prompt shows only the folder", () => expect(workTitle({ ...base, terminalTitle: "repos" })).toBeUndefined());
  test("a stale title is no context", () => expect(workTitle({ ...base, terminalTitle: "Old work", terminalTitleStale: true })).toBeUndefined());
  test("claude waits for its journal title", () => expect(workTitle({ ...base, agent: "claude", terminalTitle: "Claude Code" })).toBeUndefined());
});

function pane(paneId: string, extra: Partial<AgentView> = {}): AgentView {
  // SAFETY: the reconcile reads only the fields set here and in `extra`.
  return { paneId, agent: "claude", cwd: "/tmp/x", ...extra } as AgentView;
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("BotAutoName", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "bot-auto-name-"));

  test("renames a placeholder once the agent titles the work, then forgets it", async () => {
    let now = 1_000;
    const store = new BotAutoName(dir(), () => now);
    const calls: [string, string][] = [];
    const rename = async (id: string, label: string) => { calls.push([id, label]); return true; };
    store.mark("s", "p1", "Cometa");
    store.reconcile("s", [pane("p1", { paneLabel: "Cometa" })], rename);
    expect(calls).toEqual([]);
    now += 5_000;
    store.reconcile("s", [pane("p1", { paneLabel: "Cometa", agentTitle: "Domino tiles display issue" })], rename);
    await flush();
    expect(calls).toEqual([["p1", "Domino tiles"]]);
    store.reconcile("s", [pane("p1", { paneLabel: "Cometa", agentTitle: "Something else" })], rename);
    await flush();
    expect(calls.length).toBe(1);
  });

  test("a name somebody typed is never replaced", async () => {
    let now = 1_000;
    const store = new BotAutoName(dir(), () => now);
    const calls: string[] = [];
    store.mark("s", "p1", "Cometa");
    now += 120_000;
    store.reconcile("s", [pane("p1", { paneLabel: "Mi bot", agentTitle: "Fix login" })], async (_, l) => { calls.push(l); return true; });
    store.reconcile("s", [pane("p1", { paneLabel: "Cometa", agentTitle: "Fix login" })], async (_, l) => { calls.push(l); return true; });
    await flush();
    expect(calls).toEqual([]);
  });

  test("forget drops the mark; a failed rename is retried; the mark survives a restart", async () => {
    const root = dir();
    const store = new BotAutoName(root, () => 1_000);
    store.mark("s", "p1", "Cometa");
    store.mark("s", "p2", "Faro");
    store.forget("s", "p2");
    let ok = false;
    const calls: string[] = [];
    const rename = async (id: string) => { calls.push(id); return ok; };
    const panes = [pane("p1", { paneLabel: "Cometa", agentTitle: "Fix login" }), pane("p2", { paneLabel: "Faro", agentTitle: "Other" })];
    store.reconcile("s", panes, rename);
    await flush();
    const reloaded = new BotAutoName(root, () => 2_000);
    ok = true;
    reloaded.reconcile("s", panes, rename);
    await flush();
    expect(calls).toEqual(["p1", "p1"]);
    reloaded.reconcile("other-session", panes, rename);
    await flush();
    expect(calls.length).toBe(2);
  });
});
