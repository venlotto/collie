import { asJsonNumber, asJsonObject, asJsonString, type JsonValue } from "./json";

/** The one chat the Grok list features. The row key and workspace name guard against reused pane ids. */
export interface BotFeaturedPin {
  row: string;
  space: string;
  at: number;
}

export function botFeaturedRowParts(row: string): { host: string; session: string; paneId: string } | undefined {
  if (!row || row.length > 4096) return;
  const parts = row.split("\u0000");
  if (parts.length !== 3 || !parts[2]) return;
  return { host: parts[0]!, session: parts[1]!, paneId: parts[2] };
}

/** Parse a record from the preference file, the wire or localStorage. Anything malformed reads as absent. */
export function parseBotFeaturedPin(value: JsonValue | undefined): BotFeaturedPin | undefined {
  const record = asJsonObject(value);
  const row = asJsonString(record?.row);
  const space = asJsonString(record?.space);
  const at = asJsonNumber(record?.at);
  if (row === undefined || !botFeaturedRowParts(row) || !space || space.length > 2048 ||
      at === undefined || !Number.isSafeInteger(at) || at < 0) return;
  return { row, space, at };
}

export function sameBotFeaturedPin(a: BotFeaturedPin | null | undefined, b: BotFeaturedPin | null | undefined): boolean {
  return a === b || (!!a && !!b && a.row === b.row && a.space === b.space && a.at === b.at);
}
