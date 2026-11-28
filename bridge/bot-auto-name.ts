import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { asJsonNumber, asJsonObject, asJsonString, parseJson } from "../web/src/lib/json.ts";
import type { AgentView } from "./types.ts";

// A bot created without a name gets a random placeholder from the phone ("Cometa"). Once the agent
// knows what the work is about, the bridge swaps that placeholder for one or two words of the
// agent's own title for its session: Claude's journal title ("Domino tiles display issue" → "Domino
// tiles") or, for Codex, which keeps no title, its terminal title ("Organiza agentes para Collie |
// repos" → "Organiza agentes"). It happens here and not on the phone so it lands with every phone
// closed, and once: a name somebody types afterwards is never touched again.

/** Words that never make a name on their own: articles, prepositions, conjunctions, ES + EN. */
const FILLER = new Set([
  "a", "al", "ante", "con", "de", "del", "desde", "e", "el", "en", "entre", "la", "las", "lo", "los", "o",
  "para", "por", "que", "se", "sin", "sobre", "su", "sus", "u", "un", "una", "uno", "unos", "unas", "y",
  "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with",
]);
const MAX_NAME = 22;
/** Entries a bot never used (its agent never titled the work) are forgotten after this. */
const FORGET_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
/** The phone's own rename lands a poll or two after the mark; until then the label may still be empty. */
const RENAME_GRACE_MS = 60_000;

/** One or two words of a session title, or undefined when it holds no word worth a name. */
export function shortBotName(title: string): string | undefined {
  const words = title
    .replace(/\s+[|·—–-]\s+.*$/u, "")
    .split(/[\s/:,;.()[\]{}"'«»“”¿?¡!]+/u)
    .filter(word => /\p{L}/u.test(word) && !FILLER.has(word.toLocaleLowerCase()));
  const first = words[0];
  if (!first) return undefined;
  const second = words[1];
  const name = second && first.length + 1 + second.length <= MAX_NAME ? `${first} ${second}` : first;
  const clipped = name.length > MAX_NAME ? name.slice(0, MAX_NAME) : name;
  return clipped.charAt(0).toLocaleUpperCase() + clipped.slice(1);
}

/** What the agent says the work is, or undefined while it has said nothing yet. */
export function workTitle(pane: Pick<AgentView, "agentTitle" | "terminalTitle" | "terminalTitleStale" | "agent" | "cwd">): string | undefined {
  if (pane.agentTitle) return pane.agentTitle;
  // Claude names its session in the journal; its terminal title only repeats that or says "Claude Code".
  if (pane.agent === "claude" || !pane.terminalTitle || pane.terminalTitleStale) return undefined;
  const title = pane.terminalTitle.replace(/\s+\|\s+[^|]*$/u, "").trim();
  // Codex shows the folder until a prompt arrives: the folder is not the work.
  if (!title || (pane.cwd && title === basename(pane.cwd))) return undefined;
  return title;
}

interface Entry { session: string; paneId: string; label: string; at: number }

export class BotAutoName {
  private entries: Entry[] = [];
  private readonly busy = new Set<string>();

  constructor(private readonly stateDir: string, private readonly now = () => Date.now()) {
    const file = join(stateDir, "bot-auto-name.json");
    try {
      const raw = asJsonObject(parseJson(readFileSync(file, "utf8")));
      const list = raw?.entries;
      for (const value of Array.isArray(list) ? list : []) {
        const e = asJsonObject(value);
        const session = asJsonString(e?.session), paneId = asJsonString(e?.paneId), label = asJsonString(e?.label);
        const at = asJsonNumber(e?.at);
        if (session !== undefined && paneId && label && at !== undefined) this.entries.push({ session, paneId, label, at });
      }
    } catch { /* No bot was ever created without a name. */ }
  }

  /** The phone gave this pane a random placeholder name: replace it once the work has a title. */
  mark(session: string, paneId: string, label: string) {
    this.save([...this.entries.filter(e => !(e.session === session && e.paneId === paneId)), { session, paneId, label, at: this.now() }]);
  }

  /** A name typed by a person always wins over the placeholder. */
  forget(session: string, paneId: string) {
    if (this.entries.some(e => e.session === session && e.paneId === paneId)) {
      this.save(this.entries.filter(e => !(e.session === session && e.paneId === paneId)));
    }
  }

  /**
   * Called on every successful poll of one session. Fire-and-forget: renames run in the background,
   * one per pane at a time, and a failed one is retried on a later poll.
   */
  reconcile(session: string, panes: readonly AgentView[], rename: (paneId: string, label: string) => Promise<boolean>) {
    const now = this.now();
    const byId = new Map(panes.map(p => [p.paneId, p]));
    const keep: Entry[] = [];
    let changed = false;
    for (const e of this.entries) {
      if (e.session !== session) { keep.push(e); continue; }
      const pane = byId.get(e.paneId);
      const settling = now - e.at < RENAME_GRACE_MS;
      const renamedByPerson = pane !== undefined && pane.paneLabel !== e.label && !(settling && pane.paneLabel === undefined);
      if (renamedByPerson || now - e.at > FORGET_AFTER_MS) { changed = true; continue; }
      keep.push(e);
      if (!pane || pane.paneLabel !== e.label) continue;
      const title = workTitle(pane);
      const name = title === undefined ? undefined : shortBotName(title);
      const key = `${session}\0${e.paneId}`;
      if (!name || this.busy.has(key)) continue;
      this.busy.add(key);
      void this.attempt(session, e.paneId, name, key, rename);
    }
    if (changed) this.save(keep);
  }

  private async attempt(session: string, paneId: string, name: string, key: string, rename: (paneId: string, label: string) => Promise<boolean>) {
    try {
      if (await rename(paneId, name)) this.forget(session, paneId);
    } catch {
      // Retried on the next poll.
    } finally {
      this.busy.delete(key);
    }
  }

  private save(next: Entry[]) {
    this.entries = next;
    const file = join(this.stateDir, "bot-auto-name.json");
    const tmp = `${file}.${randomUUID()}`;
    try {
      writeFileSync(tmp, JSON.stringify({ version: 1, entries: next }), { flag: "wx", mode: 0o600 });
      renameSync(tmp, file);
    } catch {
      console.warn("[bot-auto-name] Could not save the placeholder names");
      try { rmSync(tmp, { force: true }); } catch { /* The directory may be read-only. */ }
    }
  }
}
