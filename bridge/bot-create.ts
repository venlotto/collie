import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asJsonObject, asJsonString, parseJson, type JsonValue } from "../web/src/lib/json.ts";
import type { BotCreatePrefs } from "./types.ts";

// coder1's three interactive wrappers. Both claudep and kimi forward argv to Claude Code.
const profiles = [
  { id: "codexp", harness: "codex", efforts: ["low", "medium", "high", "xhigh"] },
  { id: "claudep", harness: "claude", efforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "kimi", harness: "claude", efforts: ["low", "medium", "high"] },
];

export class BotCreateStore {
  constructor(private readonly stateDir: string, private readonly locate: (id: string) => string | null) {}

  catalog() {
    let last: BotCreatePrefs | null = null;
    try {
      last = this.resolve(parseJson(readFileSync(join(this.stateDir, "last-create-prefs.json"), "utf8")))?.prefs ?? null;
    } catch { /* A new state directory has no previous creation. */ }
    return { agents: profiles.filter(agent => this.locate(agent.id)), last };
  }

  resolve(raw: JsonValue | undefined) {
    const prefs = asJsonObject(raw);
    const agent = profiles.find(profile => profile.id === prefs?.agent);
    const effort = asJsonString(prefs?.effort);
    if (!agent || !effort || !agent.efforts.includes(effort)) return null;
    const binary = this.locate(agent.id);
    if (!binary) return null;
    const args = agent.harness === "codex" ? "-c model_reasoning_effort=" + effort : "--effort " + effort;
    return { prefs: { agent: agent.id, effort }, harness: agent.harness, command: Bun.$.escape(binary) + " " + args };
  }

  save(prefs: BotCreatePrefs) {
    const file = join(this.stateDir, "last-create-prefs.json");
    const tmp = `${file}.${randomUUID()}`;
    try {
      writeFileSync(tmp, JSON.stringify(prefs), { flag: "wx", mode: 0o600 });
      renameSync(tmp, file);
    } catch {
      console.warn("[launch] Could not save the last bot creation preferences");
      try { rmSync(tmp, { force: true }); } catch { /* The directory may be read-only. */ }
    }
  }
}
