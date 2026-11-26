import { isErrorBlocked, shownStatus } from "./triage";
import type { AgentStatus, AgentView } from "./types";

export type ActivityStatus = Exclude<AgentStatus, "unknown"> | "error";

/** Accept the schema-2 status file or the smaller agent-run-live snapshot projection (end in ms). */
export type AgentRunActivity = {
  status: string;
  ended_at: string | null;
  exit_code: number | null;
} | { status: string; end: number | null };

export function activityStatusFromAgentRun(run: AgentRunActivity): ActivityStatus {
  if ("exit_code" in run && typeof run.exit_code === "number") return run.exit_code === 0 ? "done" : "error";
  if ("end" in run) {
    if (run.status === "done") return "done";
    if (["failed", "timeout", "orphaned"].includes(run.status)) return "error";
  }
  if (("end" in run ? run.end : run.ended_at) === null) {
    if (run.status === "running") return "working";
    if (run.status === "blocked") return "blocked";
  }
  return "idle";
}

type ActivityPane = Pick<AgentView, "kind" | "status" | "blockedBy" | "lastActiveAt" | "lastSeenAt">
  & { agentRun?: AgentRunActivity };

// agent-run-live owns the optional snapshot field. Older snapshots have just the pane.
export function activityStatusOf(pane: ActivityPane): ActivityStatus {
  let source = pane;
  if (pane.agentRun && (pane.kind === "shell" || pane.status === "unknown")) {
    const run = pane.agentRun;
    const status = activityStatusFromAgentRun(run);
    // A shell hosting a run has a meaningful completion time even if Herdr
    // never saw a TUI transition. Read it against the same seen receipt.
    const ended = "end" in run ? run.end : Date.parse(run.ended_at ?? "");
    source = { kind: "agent", status: status === "error" ? "blocked" : status,
      blockedBy: status === "error" ? "error" : undefined,
      lastSeenAt: pane.lastSeenAt,
      lastActiveAt: typeof ended === "number" && Number.isFinite(ended) ? ended : pane.lastActiveAt };
  }
  const shown = shownStatus(source);
  if (shown === "blocked" && isErrorBlocked(source)) return "error";
  return shown === "unknown" ? "idle" : shown;
}
