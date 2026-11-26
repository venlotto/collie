import { basePath } from "./base-path";
import { parseBotFeaturedPin, type BotFeaturedPin } from "./bot-featured-wire";
import { asJsonObject, parseJsonObject } from "./json";

const prefix = "collie:bot-featured:v1:";
const key = (userId: string) => prefix + JSON.stringify([basePath(), userId]);

export interface BotFeaturedCache {
  featured: BotFeaturedPin | null;
  /** Undefined means no write is waiting; `{ value: null }` is a pending unpin. */
  pending?: { value: BotFeaturedPin | null };
}

const EMPTY: BotFeaturedCache = { featured: null };

export function loadBotFeaturedCache(userId: string): BotFeaturedCache {
  try {
    const cache = parseJsonObject(localStorage.getItem(key(userId)) ?? "");
    if (!cache) return EMPTY;
    const featured = cache.featured === null ? null : parseBotFeaturedPin(cache.featured);
    if (cache.featured !== null && featured === undefined) return EMPTY;
    const held = asJsonObject(cache.pending);
    if (cache.pending !== undefined && !held) return EMPTY;
    if (!held) return { featured: featured ?? null };
    const pending = held.value === null ? null : parseBotFeaturedPin(held.value);
    if (held.value !== null && pending === undefined) return EMPTY;
    return { featured: featured ?? null, pending: { value: pending ?? null } };
  } catch {
    return EMPTY;
  }
}

export function saveBotFeaturedCache(userId: string, cache: BotFeaturedCache): void {
  try { localStorage.setItem(key(userId), JSON.stringify(cache)); }
  catch { /* A restricted tab keeps the choice in memory. */ }
}

export function forgetBotFeaturedCache(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const name = localStorage.key(i);
      if (name?.startsWith(prefix)) localStorage.removeItem(name);
    }
  } catch { /* Nothing to wipe in a storage-restricted tab. */ }
}
