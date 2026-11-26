import { describe, expect, it } from "vitest";
import { activityStatusFromAgentRun, activityStatusOf, type AgentRunActivity } from "./activity-status";
import type { AgentView } from "./types";

const pane: AgentView = { paneId: "p1", workspaceId: "w1", workspaceLabel: "Equipo", workspaceNumber: 1,
  tabId: "t1", agent: "codex", status: "idle", cwd: "/tmp", focused: false, lastActiveAt: 100, lastSeenAt: 50 };
const running: AgentRunActivity = { status: "running", ended_at: null, exit_code: null };
const ended = "2026-11-25T22:58:00-04:00";

describe("activityStatusFromAgentRun", () => {
  it.each([
    [running, "working"],
    [{ status: "done", ended_at: ended, exit_code: 0 }, "done"],
    [{ status: "failed", ended_at: ended, exit_code: 17 }, "error"],
    [{ ...running, status: "blocked" }, "blocked"],
    [{ ...running, ended_at: ended }, "idle"],
    [{ ...running, status: "unknown" }, "idle"],
    [{ status: "running", end: null }, "working"],
    [{ status: "done", end: 150 }, "done"],
    [{ status: "failed", end: 150 }, "error"],
    [{ status: "timeout", end: 150 }, "error"],
    [{ status: "orphaned", end: 150 }, "error"],
  ] as const)("maps %j to %s", (run, expected) => expect(activityStatusFromAgentRun(run)).toBe(expected));
});

describe("activityStatusOf", () => {
  it.each(["idle", "working", "blocked", "done"] as const)("prefers Herdr's %s for a detected agent", status => {
    expect(activityStatusOf({ ...pane, status, agentRun: running })).toBe(status);
  });
  it("keeps a question visible after a visit, but clears a seen error or completion", () => {
    expect(activityStatusOf({ ...pane, status: "blocked", lastSeenAt: 100 })).toBe("blocked");
    expect(activityStatusOf({ ...pane, status: "blocked", blockedBy: "error" })).toBe("error");
    expect(activityStatusOf({ ...pane, status: "blocked", blockedBy: "error", lastSeenAt: 100 })).toBe("idle");
    expect(activityStatusOf({ ...pane, status: "done", lastSeenAt: 100 })).toBe("idle");
  });
  it("leaves an unrecognised pane quiet until its matched run arrives", () => {
    expect(activityStatusOf({ ...pane, status: "unknown" })).toBe("idle");
    expect(activityStatusOf({ ...pane, kind: "shell", status: "unknown" })).toBe("idle");
    expect(activityStatusOf({ ...pane, status: "unknown", agentRun: running })).toBe("working");
    expect(activityStatusOf({ ...pane, kind: "shell", agentRun: running })).toBe("working");
  });
  it.each([[0, "done"], [42, "error"]] as const)("compares the run's exit %i to the pane's seen receipt", (exit_code, expected) => {
    const completed = { ...pane, kind: "shell", status: "unknown", lastSeenAt: 150,
      agentRun: { status: exit_code ? "failed" : "done", exit_code, ended_at: ended } } as const;
    expect(activityStatusOf(completed)).toBe(expected);
    expect(activityStatusOf({ ...completed, lastSeenAt: Date.parse(ended) })).toBe("idle");
  });
  it("compares the projected snapshot's millisecond end to the receipt too", () => {
    const completed = { ...pane, status: "unknown", agentRun: { status: "done", end: 170 } } as const;
    expect(activityStatusOf(completed)).toBe("done");
    expect(activityStatusOf({ ...completed, lastSeenAt: 170 })).toBe("idle");
  });
});
