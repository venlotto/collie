import { asJsonObject, asJsonString, type JsonValue } from "./json";
import type { PaneView } from "./pane-view";

/** The body this bot opens with on every device. An absent row means Messages. */
export type BotDisplay = PaneView;

/** Agent-view aside wins; a bot's shared choice then outranks this device's non-bot default. */
export function resolvePaneView(agentAside: BotDisplay | null | undefined, bot: BotDisplay | undefined, device: BotDisplay): BotDisplay {
  return agentAside ?? bot ?? device;
}

export interface BotDisplayRow { row: string; view: BotDisplay }

export function botDisplayRowParts(row: string): { host: string; session: string; paneId: string } | undefined {
  if (!row || row.length > 4096) return;
  const parts = row.split("\u0000");
  if (parts.length !== 3 || !parts[2]) return;
  return { host: parts[0]!, session: parts[1]!, paneId: parts[2] };
}

export function parseBotDisplay(value: JsonValue | undefined): BotDisplay | undefined {
  return value === "chat" || value === "terminal" ? value : undefined;
}

export function parseBotDisplayRow(value: JsonValue | undefined): BotDisplayRow | undefined {
  const record = asJsonObject(value);
  if (record === undefined || Object.keys(record).length !== 2) return;
  const row = asJsonString(record.row);
  const view = parseBotDisplay(record.view);
  if (row === undefined || !botDisplayRowParts(row) || view === undefined) return;
  return { row, view };
}
