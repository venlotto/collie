// The wipe can run during boot, before the router or its authenticated requests exist.
import { basePath } from "./base-path";
import { asJsonObject, asJsonString, parseJsonObject } from "./json";

const prefix = "collie:bot-sections:v1:";
const key = (userId: string) => prefix + JSON.stringify([basePath(), userId]);

export function loadSectionCache(userId: string) {
  const folded = new Set<string>();
  const pending = new Map<string, boolean>();
  try {
    const cache = parseJsonObject(localStorage.getItem(key(userId)) ?? "");
    if (Array.isArray(cache?.folded) && cache.folded.every(item => asJsonString(item) !== undefined)) {
      for (const item of cache.folded) folded.add(asJsonString(item)!);
      for (const [id, value] of Object.entries(asJsonObject(cache.pending) ?? {})) {
        if (value === true || value === false) pending.set(id, value);
      }
    }
  } catch { /* A storage-restricted tab can still use the bridge. */ }
  return { folded, pending };
}

export function saveSectionCache(userId: string, folded: Set<string>, pending: Map<string, boolean>) {
  try { localStorage.setItem(key(userId), JSON.stringify({ folded: [...folded], pending: Object.fromEntries(pending) })); }
  catch { /* Keep the choice in memory when storage is unavailable. */ }
}

export function forgetSectionCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const name = localStorage.key(i);
      if (name?.startsWith(prefix)) localStorage.removeItem(name);
    }
  } catch { /* Nothing to wipe in a storage-restricted tab. */ }
}
