import { Database } from "bun:sqlite";
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { botFeaturedRowParts, parseBotFeaturedPin, sameBotFeaturedPin, type BotFeaturedPin } from "../web/src/lib/bot-featured-wire.ts";
import { asJsonObject, parseJson, parseJsonObject } from "../web/src/lib/json.ts";
import type { AgentView } from "./types.ts";

const accountSetting = "bot-featured:v1";
let serial = 0;

export function botFeaturedChange(raw: string): { featured: BotFeaturedPin | null } | undefined {
  const input = parseJsonObject(raw);
  if (!input || Object.keys(input).length !== 1 || !("featured" in input)) return;
  if (input.featured === null) return { featured: null };
  const featured = parseBotFeaturedPin(input.featured);
  return featured ? { featured } : undefined;
}

type CensusPane = Pick<AgentView, "paneId" | "workspaceLabel" | "terminalId">;

/** One per-user, last-write-wins slot. Synchronous read/modify/rename serialises device writes in this bridge. */
export class BotFeatured {
  private users = new Map<string, BotFeaturedPin>();
  private readonly file: string;
  private readonly lastSweep = new Map<string, { signature: string; at: number }>();

  constructor(private readonly stateDir: string, readonly sso = false) {
    this.file = join(stateDir, "bot-featured.json");
    let content: string;
    try { content = readFileSync(this.file, "utf8"); }
    catch { return; }
    const raw = parseJsonObject(content);
    const users = raw?.version === 1 && asJsonObject(raw.users);
    if (!users) return;
    const loaded = new Map<string, BotFeaturedPin>();
    for (const [user, value] of Object.entries(users)) {
      if (value === null) continue;
      const pin = parseBotFeaturedPin(value);
      if (!pin) return;
      loaded.set(user, pin);
    }
    this.users = loaded;
  }

  read(userId: string) {
    return { userId, featured: this.users.get(userId) ?? null };
  }

  update(userId: string, featured: BotFeaturedPin | null) {
    const current = this.users.get(userId) ?? null;
    if (!sameBotFeaturedPin(current, featured)) {
      const next = new Map(this.users);
      if (featured) next.set(userId, featured); else next.delete(userId);
      this.save(next);
    }
    return this.read(userId);
  }

  private save(next: Map<string, BotFeaturedPin>) {
    const users = Object.fromEntries(next);
    const tmp = join(this.stateDir, `bot-featured.json.${process.pid}.${++serial}.tmp`);
    const fd = openSync(tmp, "wx", 0o600);
    try {
      try { writeFileSync(fd, JSON.stringify({ version: 1, users })); }
      finally { closeSync(fd); }
      renameSync(tmp, this.file);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
    this.users = next;
  }

  /** A complete local census clears trash, deletion and id reuse; it never infers anything about a peer. */
  reconcile(session: string, primary: boolean, panes: readonly CensusPane[], isTrashed: (pane: CensusPane) => boolean) {
    const gone = (pin: BotFeaturedPin) => {
      const row = botFeaturedRowParts(pin.row);
      if (!row || row.host || !((primary && row.session === "") || row.session === session)) return false;
      const pane = panes.find(candidate => candidate.paneId === row.paneId);
      return !pane || pane.workspaceLabel !== pin.space || isTrashed(pane);
    };
    const next = new Map(this.users);
    let dirty = false;
    for (const [user, pin] of this.users) {
      if (!gone(pin)) continue;
      next.delete(user);
      dirty = true;
    }
    if (dirty) this.save(next);
    if (!this.sso) return;

    const signature = JSON.stringify(panes.map(pane => [pane.paneId, pane.workspaceLabel, isTrashed(pane)]).toSorted());
    const previous = this.lastSweep.get(session);
    const now = Date.now();
    if (previous && previous.signature === signature && now - previous.at < 60_000) return;
    const path = join(this.stateDir, "sso-owners.sqlite");
    if (!existsSync(path)) return;
    using db = new Database(path, { readwrite: true });
    db.transaction(() => {
      const rows = db.query<{ sub: string; value: string }, [string]>("SELECT sub,value FROM settings WHERE name=?").all(accountSetting);
      for (const { sub, value } of rows) {
        const pin = parseBotFeaturedPin(parseJson(value));
        if (pin && gone(pin)) db.run("DELETE FROM settings WHERE sub=? AND name=?", [sub, accountSetting]);
      }
    }).immediate();
    this.lastSweep.set(session, { signature, at: now });
  }
}
