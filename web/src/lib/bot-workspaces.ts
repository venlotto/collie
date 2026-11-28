import { ambientSpaces, findPane } from "./hosts";
import type { Scope } from "./scope";
import type { AgentView, ServerSummary, SessionSummary, WorkspaceView } from "./types";

/** Destinations on this machine/session, excluding workspaces sent whole to Trash. */
export function activeBotWorkspaces(
  workspaces: readonly WorkspaceView[], panes: readonly AgentView[], scope: Scope,
  servers?: readonly ServerSummary[], sessions?: readonly SessionSummary[],
): WorkspaceView[] {
  const here = panes.filter(p => findPane([p], p.paneId, scope, servers, sessions) !== undefined);
  const removed = new Set(here.flatMap(p => p.trash?.workspaceLabel !== undefined ? [p.trash.originalWorkspaceId] : []));
  // A live chat created there later makes the workspace active again, as in the chat list.
  for (const pane of here) if (!pane.trash) removed.delete(pane.workspaceId);
  return ambientSpaces(workspaces, scope, servers).filter(w => !removed.has(w.workspaceId));
}
