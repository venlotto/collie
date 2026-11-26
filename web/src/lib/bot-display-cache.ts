import { basePath } from "./base-path";
import { parseBotDisplay, parseBotDisplayRow, type BotDisplay, type BotDisplayRow } from "./bot-display-wire";
import { asJsonObject, parseJsonObject } from "./json";

const prefix = "collie:bot-display:v1:";
const key = (userId: string) => prefix + JSON.stringify([basePath(), userId]);

export interface BotDisplayCache {
  views: Map<string, BotDisplay>;
  pending: Map<string, BotDisplay>;
}

export function loadBotDisplayCache(userId: string): BotDisplayCache {
  const views = new Map<string, BotDisplay>();
  const pending = new Map<string, BotDisplay>();
  try {
    const cache = parseJsonObject(localStorage.getItem(key(userId)) ?? "");
    if (!cache || !Array.isArray(cache.views)) return { views, pending };
    for (const value of cache.views) {
      const parsed = parseBotDisplayRow(value);
      if (!parsed) return { views: new Map(), pending: new Map() };
      views.set(parsed.row, parsed.view);
    }
    for (const [row, value] of Object.entries(asJsonObject(cache.pending) ?? {})) {
      const view = parseBotDisplay(value);
      const parsed = parseBotDisplayRow({ row, view });
      if (!parsed) return { views: new Map(), pending: new Map() };
      pending.set(row, parsed.view);
    }
  } catch { /* A storage-restricted tab still uses the bridge. */ }
  return { views, pending };
}

export function saveBotDisplayCache(userId: string, cache: BotDisplayCache): void {
  const views: BotDisplayRow[] = [...cache.views].map(([row, view]) => ({ row, view }));
  try { localStorage.setItem(key(userId), JSON.stringify({ views, pending: Object.fromEntries(cache.pending) })); }
  catch { /* The choice stays in memory. */ }
}

export function forgetBotDisplayCache(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const name = localStorage.key(i);
      if (name?.startsWith(prefix)) localStorage.removeItem(name);
    }
  } catch { /* Nothing to wipe in a storage-restricted tab. */ }
}
