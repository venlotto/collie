import { asJsonString, parseJsonObject } from "./json";
import type { BotCreatePrefs } from "./types";

const prefix = "collie:bot-create:v1:";
export function readBotPrefs(host = ""): BotCreatePrefs {
  try {
    const raw = parseJsonObject(localStorage.getItem(prefix + host) ?? "");
    const agent = asJsonString(raw?.agent);
    const effort = asJsonString(raw?.effort);
    if (agent && effort) return { agent, effort };
  } catch { /* Storage may be unavailable. */ }
  return { agent: "codexp", effort: "high" };
}

export function cacheBotPrefs(host: string | undefined, prefs: BotCreatePrefs) {
  try { localStorage.setItem(prefix + (host ?? ""), JSON.stringify(prefs)); } catch { /* Server retains the choice. */ }
}
