import { describe, expect, test } from "bun:test";

import { AuditLog, type AuditEntry } from "./audit.ts";
import type { JsonObject } from "./json.ts";
import { launch } from "./server.ts";
import type { StateEngine } from "./state-engine.ts";
import type { AgentView, Launcher, WorkspaceView } from "./types.ts";
import {
  muxAck,
  muxOk,
  type MuxAck,
  type MuxAdapter,
  type MuxCreatedPane,
  type MuxGrid,
  type MuxOutcome,
  type MuxSpaceRequest,
  type MuxTabRequest,
} from "./mux/types.ts";
import { declareCapabilities } from "./mux/capabilities.ts";

// `POST /api/launch` with a place for the new pane (the bot sheet's workspace choice):
//
//   1. `spaceId` opens a TAB in that existing workspace, in its first pane's folder; an unknown id is
//      a 404 `launch.space_unknown` before anything runs.
//   2. `spaceLabel` opens a NEW workspace with that name, kept free like a folder name.
//   3. At most one of `paneId`, `spaceId` and `spaceLabel`; a blank or overlong place is a 400.

const ROW: Launcher = { command: "htop", label: "Top" };

function space(workspaceId: string, label: string): WorkspaceView {
  return { workspaceId, number: 1, label, focused: false, activeTabId: `${workspaceId}:t1`, tabCount: 1, paneCount: 1 };
}

function pane(paneId: string, workspaceId: string, cwd: string): AgentView {
  return { paneId, workspaceId, workspaceLabel: "", workspaceNumber: 1, tabId: `${workspaceId}:t1`, agent: "shell", status: "unknown", cwd, focused: false };
}

function engineWith(workspaces: WorkspaceView[], agents: AgentView[] = []): StateEngine {
  const stub: Partial<StateEngine> = {
    pokeNow: () => {},
    current: () => ({ agents, shellPanes: [], workspaces, tabs: [], bridge: "connected" }),
  };
  // SAFETY: `launch` reaches only `current()` (the place lookups and the names taken) and `pokeNow()`.
  return stub as StateEngine;
}

const clock = () => {
  let ms = 0;
  return { now: () => ms, sleep: (by: number) => { ms += by; return Promise.resolve(); } };
};

class FakeMux {
  readonly spaces: MuxSpaceRequest[] = [];
  readonly tabs: MuxTabRequest[] = [];
  readonly texts: Array<[string, string]> = [];
  capabilities = declareCapabilities({ supports: ["createSpace", "createTab", "renameTab"], topologyLatency: { kind: "push" } });

  createSpace(request: MuxSpaceRequest): Promise<MuxOutcome<MuxCreatedPane>> {
    this.spaces.push(request);
    return Promise.resolve(muxOk({ paneId: "w9:p1", spaceId: "w9", spaceLabel: request.label ?? "shell", tabId: "w9:t1", cwd: request.cwd ?? "/" }));
  }
  createTab(request: MuxTabRequest): Promise<MuxOutcome<MuxCreatedPane>> {
    this.tabs.push(request);
    return Promise.resolve(muxOk({ paneId: `${request.spaceId}:p9`, spaceId: request.spaceId, spaceLabel: "", tabId: `${request.spaceId}:t9`, cwd: request.cwd ?? "/" }));
  }
  renameTab(): Promise<MuxAck> {
    return Promise.resolve(muxAck());
  }
  readGrid(paneId: string): Promise<MuxOutcome<MuxGrid>> {
    return Promise.resolve(muxOk({ paneId, text: "$ ", truncated: false, revision: 1 }));
  }
  typeText(paneId: string, text: string): Promise<MuxAck> {
    this.texts.push([paneId, text]);
    return Promise.resolve(muxAck());
  }
  writeKeys(): Promise<MuxAck> {
    return Promise.resolve(muxAck());
  }
  closePane(): Promise<MuxAck> {
    return Promise.resolve(muxAck());
  }
  refresh(): Promise<void> {
    return Promise.resolve();
  }
}

function asMux(fake: Partial<MuxAdapter>): MuxAdapter {
  // SAFETY: a launch reaches only the calls FakeMux implements, plus its `capabilities` declaration.
  return fake as MuxAdapter;
}

function audit() {
  const entries: AuditEntry[] = [];
  return {
    log: new AuditLog((line) => {
      // SAFETY: the appender only ever receives formatAuditLine's own JSON output.
      entries.push(JSON.parse(line) as AuditEntry);
    }),
    entries,
  };
}

const post = (body: JsonObject) =>
  new Request("http://x/api/launch", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

async function run(body: JsonObject, engine: StateEngine) {
  const mux = new FakeMux();
  const { log, entries } = audit();
  const res = await launch(asMux(mux), engine, post(body), log, null, "default", () => Promise.resolve([ROW]), clock());
  return { res, mux, entries };
}

describe("launch into a chosen workspace", () => {
  test("spaceId opens a tab in that workspace, in its first pane's folder", async () => {
    const engine = engineWith([space("w2", "Sin asignar")], [pane("w2:p1", "w2", "/home/op/inbox")]);
    const { res, mux, entries } = await run({ command: "htop", spaceId: "w2" }, engine);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, pane: { workspaceId: "w2", workspaceLabel: "Sin asignar" } });
    expect(mux.spaces).toEqual([]);
    expect(mux.tabs).toEqual([{ spaceId: "w2", label: "Top", cwd: "/home/op/inbox" }]);
    expect(entries[0]?.action).toBe("tab.launch");
    expect(entries[0]?.detail).toMatchObject({ spaceId: "w2" });
  });

  test("an unknown spaceId is a 404 before anything runs", async () => {
    const { res, mux } = await run({ command: "htop", spaceId: "ghost" }, engineWith([space("w2", "Bots")]));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, code: "launch.space_unknown" });
    expect(mux.spaces).toEqual([]);
    expect(mux.tabs).toEqual([]);
    expect(mux.texts).toEqual([]);
  });

  test("spaceLabel opens a new workspace with that name", async () => {
    const { res, mux } = await run({ command: "htop", spaceLabel: "  Proyecto X " }, engineWith([]));
    expect(res.status).toBe(200);
    expect(mux.spaces).toHaveLength(1);
    expect(mux.spaces[0]?.label).toBe("Proyecto X");
    expect(mux.tabs).toEqual([]);
  });

  test("a taken name is kept free, as a folder name is", async () => {
    const { mux } = await run({ command: "htop", spaceLabel: "Sin asignar" }, engineWith([space("w1", "Sin asignar")]));
    expect(mux.spaces[0]?.label).toBe("Sin asignar-2");
  });

  test.each([
    [{ spaceId: "w2", spaceLabel: "X" }],
    [{ paneId: "w2:p1", spaceId: "w2" }],
    [{ paneId: "w2:p1", spaceLabel: "X" }],
    [{ spaceId: "  " }],
    [{ spaceLabel: "   " }],
    [{ spaceLabel: "x".repeat(81) }],
    [{ spaceLabel: 7 }],
  ])("a place that is not exactly one valid choice is a 400: %j", async (place) => {
    const engine = engineWith([space("w2", "Bots")], [pane("w2:p1", "w2", "/home/op")]);
    const { res, mux } = await run({ command: "htop", ...place }, engine);
    expect(res.status).toBe(400);
    expect(mux.spaces).toEqual([]);
    expect(mux.tabs).toEqual([]);
  });
});
