// A `blocked` the screen does not back is not "Needs you" (blocked-settle.ts, Koperca catalogue C).
// The pure rule, then the real reader over the Codex 0.172.0 captures, then the engine wired the way
// bridge/index.ts wires it.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Surface } from "../web/src/lib/surface/surface.ts";
import { settleBlocked } from "./blocked-settle.ts";
import type { MuxAdapter, MuxGrid, MuxGridRequest, MuxOutcome, MuxPane } from "./mux/types.ts";
import { StateEngine } from "./state-engine.ts";
import { SurfaceShadow } from "./surface/shadow.ts";
import type { AgentStatus, AgentView } from "./types.ts";

const PANES = join(import.meta.dir, "..", "web", "src", "fixtures", "panes");
const screen = (name: string): string => readFileSync(join(PANES, name), "utf8");

/** Codex 0.172.0, 52 columns, a disposable Herdr pane: the turn runs, a question waits in the queue. */
const QUEUED = "codex--v0172-async-question--w52.txt";
/** The same pane a moment after the question was answered: the turn runs, nothing waits. */
const ANSWERED = "codex--v0172-async-answered--w52.txt";
/** The question opened over the box: a real ask. */
const PANEL = "codex--v0172-async-panel--w52.txt";

const surface = (over: Partial<Surface>): Surface => ({ revision: 0, turn: "running", modal: "none", composer: "empty", ...over });

describe("settleBlocked, the rule", () => {
  test("a clean read with a free box and nothing queued is what its turn says", () => {
    expect(settleBlocked(surface({ turn: "running" }), false)).toBe("working");
    expect(settleBlocked(surface({ turn: "idle" }), false)).toBe("idle");
    expect(settleBlocked(surface({ turn: "running", composer: "draft" }), false)).toBe("working");
  });

  test("a queued question keeps the multiplexer's blocked", () => {
    expect(settleBlocked(surface({}), true)).toBeNull();
  });

  test("anything less certain keeps it too", () => {
    expect(settleBlocked(undefined, false)).toBeNull();
    expect(settleBlocked(surface({ modal: { ask: { id: "a", kind: "permission", options: [], channel: "keys", hash: "h" } } }), false)).toBeNull();
    expect(settleBlocked(surface({ modal: "unreadable" }), false)).toBeNull();
    expect(settleBlocked(surface({ modal: "unknown" }), false)).toBeNull();
    expect(settleBlocked(surface({ composer: "unreachable" }), false)).toBeNull();
    expect(settleBlocked(surface({ composer: "unknown" }), false)).toBeNull();
    expect(settleBlocked(surface({ turn: "unknown" }), false)).toBeNull();
    expect(settleBlocked(surface({ reason: "stale" }), false)).toBeNull();
    expect(settleBlocked(surface({ reason: "contested" }), false)).toBeNull();
    expect(settleBlocked(surface({ staleFrame: true }), false)).toBeNull();
  });
});

class FakeMux {
  screens = new Map<string, string>();
  status = new Map<string, AgentStatus>();
  readGrid = async (paneId: string, _request: MuxGridRequest): Promise<MuxOutcome<MuxGrid>> => {
    const text = this.screens.get(paneId);
    if (text === undefined) return { ok: false, reason: "gone", detail: "no such pane" };
    return { ok: true, value: { paneId, text, truncated: false, revision: 0 } };
  };
}

function shadowOver(mux: FakeMux): SurfaceShadow {
  const reads: Pick<MuxAdapter, "readGrid"> = { readGrid: mux.readGrid };
  // SAFETY: the shadow reads a pane through `readGrid` alone (shadow.test.ts's FakeMux is the same stub),
  // so the members this stub leaves out are never called.
  return new SurfaceShadow({ mux: reads as MuxAdapter, pollMs: 1000, log: () => undefined, now: () => 1_000_000, version: async () => "0.172.0" });
}

const codex = (paneId: string): AgentView => ({
  paneId, workspaceId: "w1", workspaceLabel: "one", workspaceNumber: 1, tabId: "w1:t1", agent: "codex", status: "blocked", cwd: "/x", focused: false,
});

describe("the reader over Codex 0.172.0's screens", () => {
  test("the queued question: blocked stands, and it is no ask (the box stays free)", async () => {
    const mux = new FakeMux();
    mux.screens.set("w1:p1", screen(QUEUED));
    const shadow = shadowOver(mux);
    await shadow.observe([codex("w1:p1")]);
    expect(shadow.questionQueued("w1:p1")).toBe(true);
    expect(shadow.askOnScreen("w1:p1")).toBe(false);
    expect(shadow.surfaceOf("w1:p1")).toMatchObject({ turn: "running", modal: "none", composer: "empty" });
    expect(settleBlocked(shadow.surfaceOf("w1:p1"), shadow.questionQueued("w1:p1"))).toBeNull();
  });

  test("answered: nothing waits, so a blocked left behind settles to working", async () => {
    const mux = new FakeMux();
    mux.screens.set("w1:p1", screen(ANSWERED));
    const shadow = shadowOver(mux);
    await shadow.observe([codex("w1:p1")]);
    expect(shadow.questionQueued("w1:p1")).toBe(false);
    expect(settleBlocked(shadow.surfaceOf("w1:p1"), shadow.questionQueued("w1:p1"))).toBe("working");
  });

  test("the question opened: an ask on screen", async () => {
    const mux = new FakeMux();
    mux.screens.set("w1:p1", screen(PANEL));
    const shadow = shadowOver(mux);
    await shadow.observe([codex("w1:p1")]);
    expect(shadow.askOnScreen("w1:p1")).toBe(true);
    expect(settleBlocked(shadow.surfaceOf("w1:p1"), shadow.questionQueued("w1:p1"))).toBeNull();
  });
});

/** The engine's multiplexer: one listing of the panes and the status each reports. */
function herdOf(mux: FakeMux): MuxAdapter {
  const herd: Pick<MuxAdapter, "snapshot"> = {
    snapshot: async () => ({
      panes: [...mux.status].map(([paneId, status]): MuxPane => ({
        paneId, spaceId: "w1", spaceLabel: "one", spaceNumber: 1, tabId: "w1:t1", agent: "codex", status, cwd: "/x", focused: false, alive: true,
      })),
      spaces: [],
      tabs: [],
    }),
  };
  // SAFETY: a poll of a Codex pane reaches `snapshot` alone (the session-name scrape reads Claude and
  // Muse panes only, shadow.test.ts), so the members this stub leaves out are never called.
  return herd as MuxAdapter;
}

describe("the engine, wired as bridge/index.ts wires it", () => {
  async function rig() {
    const mux = new FakeMux();
    const shadow = shadowOver(mux);
    const engine = new StateEngine(herdOf(mux), 1500);
    engine.liftScreenAsks((paneId) => shadow.askOnScreen(paneId) || shadow.questionQueued(paneId));
    engine.settleBlockedByScreen((paneId) => settleBlocked(shadow.surfaceOf(paneId), shadow.questionQueued(paneId)));
    const transitions: { from: AgentStatus; to: AgentStatus }[] = [];
    engine.onTransition((_a, from, to) => transitions.push({ from, to }));
    // The read trails the poll by one, as in the bridge: the poll, then the Surface reads its agents.
    const poll = async () => {
      await engine["poll"]();
      await shadow.observe(engine.current().agents);
    };
    return { mux, engine, transitions, poll };
  }

  test.each(["idle", "done", "working", "blocked"] as const)("a queued question lifts even mux %s to Needs you", async (status) => {
    const { mux, engine, poll } = await rig();
    mux.status.set("w1:p1", status);
    mux.screens.set("w1:p1", screen(QUEUED));
    await poll(); await poll();
    expect(engine.current().agents[0]!.status).toBe("blocked");
  });

  test("Action Required with nothing asked reads working, and no blocked transition reaches the push", async () => {
    const { mux, engine, transitions, poll } = await rig();
    mux.status.set("w1:p1", "working");
    mux.screens.set("w1:p1", screen(ANSWERED));
    await poll();
    mux.status.set("w1:p1", "blocked");
    await poll();
    await poll();
    expect(engine.current().agents[0]!.status).toBe("working");
    expect(transitions).toEqual([]);
  });

  test("a queued question is Needs you, and answering it clears the mark", async () => {
    const { mux, engine, transitions, poll } = await rig();
    mux.status.set("w1:p1", "working");
    mux.screens.set("w1:p1", screen(ANSWERED));
    await poll();
    mux.status.set("w1:p1", "blocked");
    mux.screens.set("w1:p1", screen(QUEUED));
    await poll(); // the read of the queue lands after this poll
    await poll();
    expect(engine.current().agents[0]!.status).toBe("blocked");
    // Answered: the title can lag the screen; the screen wins at the next read.
    mux.screens.set("w1:p1", screen(ANSWERED));
    await poll();
    await poll();
    expect(engine.current().agents[0]!.status).toBe("working");
    expect(transitions.map((t) => `${t.from}>${t.to}`)).toEqual(["working>blocked", "blocked>working"]);
  });
});
