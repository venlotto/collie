// Herdr may issue a different pane address when the same terminal moves to another workspace.
export function chatOrderId(pane: { paneId: string; terminalId?: string }): string {
  return pane.terminalId ?? pane.paneId;
}

export interface ChatOrder {
  workspaceId: string;
  paneIds: string[];
}
