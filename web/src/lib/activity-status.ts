import { isErrorBlocked, shownStatus } from "./triage";
import type { AgentStatus, AgentView } from "./types";

type RunActivityStatus = Exclude<AgentStatus, "unknown"> | "error";
export type ActivityStatus = RunActivityStatus | "sendFailed" | "sendUnknown" | "sending";

/** Accept the schema-2 status file or the smaller agent-run-live snapshot projection (end in ms). */
export type AgentRunActivity = {
  status: string;
  ended_at: string | null;
  exit_code: number | null;
} | { status: string; end: number | null };

export function activityStatusFromAgentRun(run: AgentRunActivity): RunActivityStatus {
  if ("exit_code" in run && run.exit_code != null) return run.exit_code === 0 ? "done" : "error";
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

type ActivityPane = Pick<AgentView, "kind" | "status" | "blockedBy" | "lastActiveAt" | "lastSeenAt" | "surface" | "lastSend">
  & { agentRun?: AgentRunActivity };

// agent-run-live owns the optional snapshot field. Older snapshots have just the pane.
export function activityStatusOf(pane: ActivityPane, local: "sending" | "sendUnknown" | null = null): ActivityStatus {
  if (local !== null) return local;
  const delivery = pane.lastSend?.outcome;
  if (pane.lastSend?.late === "returned") return "sendFailed";
  if (delivery === "refused" || delivery === "typed_not_submitted" || delivery === "expired") return "sendFailed";
  if (delivery === "unknown" && pane.lastSend?.word !== "arrived") return "sendUnknown";
  if (delivery === "pending" || delivery === "held") return "sending";
  // A positive running screen corrects a delayed mux idle/done report. A blocked
  // pane still wins: an asynchronous question can coexist with a running turn.
  if ((pane.status === "idle" || pane.status === "done") && pane.surface?.turn === "running"
    && pane.surface.modal === "none" && !pane.surface.reason && !pane.surface.staleFrame) return "working";
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
      lastActiveAt: ended !== null && Number.isFinite(ended) ? ended : pane.lastActiveAt };
  }
  const shown = shownStatus(source);
  if (shown === "blocked" && isErrorBlocked(source)) return "error";
  return shown === "unknown" ? "idle" : shown;
}
