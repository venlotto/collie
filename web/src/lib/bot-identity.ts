import { asJsonNumber, asJsonString, parseJsonObject } from "@/lib/json";
import { paneScopeKey, type Scope } from "@/lib/scope";

export const colors = ["#fff", "#85552f", "#ff273f", "#ff6200", "#ff9500", "#00c76a", "#00b5a7", "#0a84ff", "#854dff", "#ff2d87", "#727276"];
export const colorNames = ["Blanco", "Marrón", "Rojo", "Mandarina", "Naranja", "Verde", "Turquesa", "Azul", "Violeta", "Rosa", "Gris"];
export const silhouetteCount = 13;

/** Shared defaults for quick creation and the editable creation sheet. */
export function randomBotAppearance() {
  const palette = [8, 5, 3, 9, 7, 6, 2, 4];
  return {
    silhouette: Math.floor(Math.random() * silhouetteCount),
    color: palette[Math.floor(Math.random() * palette.length)]!,
  };
}

export interface BotIdentity { name: string; silhouette: number; color: number }

const prefix = "collie:bot:v1:";
const memory = new Map<string, BotIdentity>();
function address(scope: Scope, id: string) {
  return prefix + encodeURIComponent(paneScopeKey(scope, id));
}

export function forgetBot(scope: Scope, id: string) {
  const key = address(scope, id);
  memory.delete(key);
  try { localStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
}

export function forgetBots() {
  memory.clear();
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch { /* Nothing persisted in a storage-restricted tab. */ }
}

export function saveBot(scope: Scope, id: string, bot: BotIdentity) {
  const key = address(scope, id);
  memory.set(key, bot);
  try { localStorage.setItem(key, JSON.stringify(bot)); } catch { /* Available for this visit. */ }
}

export function savedBot(scope: Scope, id: string): BotIdentity | undefined {
  const key = address(scope, id);
  let saved = memory.get(key);
  if (!saved) {
    try {
      const value = parseJsonObject(localStorage.getItem(key) ?? "");
      const name = asJsonString(value?.name);
      const silhouette = asJsonNumber(value?.silhouette);
      const color = asJsonNumber(value?.color);
      if (name && silhouette !== undefined && Number.isInteger(silhouette) && silhouette >= 0 && silhouette < silhouetteCount &&
          color !== undefined && Number.isInteger(color) && colors[color]) {
        saved = { name, silhouette, color };
        memory.set(key, saved);
      }
    } catch { /* Storage can be unavailable in a private tab. */ }
  }
  return saved;
}
