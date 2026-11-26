import { Database } from "bun:sqlite";
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { botDisplayRowParts, parseBotDisplay, type BotDisplay, type BotDisplayRow } from "../web/src/lib/bot-display-wire.ts";
import { asJsonObject, asJsonString, parseJsonObject } from "../web/src/lib/json.ts";
import type { AgentView } from "./types.ts";

const accountPrefix = "bot-display:v1:";
let serial = 0;

export function botDisplayChange(raw: string): BotDisplayRow | undefined {
  const input = parseJsonObject(raw);
  if (!input || Object.keys(input).length !== 2) return;
  const row = asJsonString(input.row);
  const view = parseBotDisplay(input.view);
  return row !== undefined && botDisplayRowParts(row) && view ? { row, view } : undefined;
}

type CensusPane = Pick<AgentView, "paneId" | "terminalId">;
type UserViews = Map<string, BotDisplay>;

/** Per-bot, per-user display choices. Synchronous deltas keep independent devices' changes in arrival order. */
export class BotDisplays {
  private users = new Map<string, UserViews>();
  private readonly file: string;
  private readonly lastSweep = new Map<string, { signature: string; at: number }>();

  constructor(private readonly stateDir: string, readonly sso = false) {
    this.file = join(stateDir, "bot-display.json");
    let content: string;
    try { content = readFileSync(this.file, "utf8"); }
    catch { return; }
    const raw = parseJsonObject(content);
    const users = raw?.version === 1 && asJsonObject(raw.users);
    if (!users) return;
    const loaded = new Map<string, UserViews>();
    for (const [user, value] of Object.entries(users)) {
      const views = asJsonObject(value);
      if (!views) return;
      const parsed: UserViews = new Map();
      for (const [row, rawView] of Object.entries(views)) {
        const view = parseBotDisplay(rawView);
        if (!botDisplayRowParts(row) || !view) return;
        parsed.set(row, view);
      }
      loaded.set(user, parsed);
    }
    this.users = loaded;
  }

  read(userId: string) {
    return {
      userId,
      views: [...(this.users.get(userId) ?? [])].map(([row, view]) => ({ row, view })),
    };
  }

  update(userId: string, change: BotDisplayRow) {
    const next = new Map(this.users.get(userId));
    if (next.get(change.row) !== change.view) {
      next.set(change.row, change.view);
      this.save(new Map(this.users).set(userId, next));
    }
    return this.read(userId);
  }

  private save(next: Map<string, UserViews>) {
    const users = Object.fromEntries([...next]
      .filter(([, views]) => views.size > 0)
      .map(([user, views]) => [user, Object.fromEntries(views)]));
    const stateDir = this.stateDir;
    const tmp = join(stateDir, `bot-display.json.${process.pid}.${++serial}.tmp`);
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

  /** A complete local census clears deletion, trash and id reuse; it says nothing about a peer. */
  reconcile(session: string, primary: boolean, panes: readonly CensusPane[], isTrashed: (pane: CensusPane) => boolean) {
    const gone = (row: string) => {
      const address = botDisplayRowParts(row);
      if (!address || address.host || !((primary && address.session === "") || address.session === session)) return false;
      const pane = panes.find(candidate => candidate.paneId === address.paneId);
      return !pane || isTrashed(pane);
    };
    const next = new Map(this.users);
    let dirty = false;
    for (const [user, views] of this.users) {
      const keep: UserViews = new Map([...views].filter(([row]) => !gone(row)));
      if (keep.size === views.size) continue;
      next.set(user, keep);
      dirty = true;
    }
    if (dirty) this.save(next);
    if (!this.sso) return;

    const signature = JSON.stringify(panes.map(pane => [pane.paneId, isTrashed(pane)]).toSorted());
    const previous = this.lastSweep.get(session);
    const now = Date.now();
    if (previous && previous.signature === signature && now - previous.at < 60_000) return;
    const path = join(this.stateDir, "sso-owners.sqlite");
    if (!existsSync(path)) return;
    using db = new Database(path, { readwrite: true });
    db.transaction(() => {
      const names = db.query<{ name: string }, [string]>("SELECT DISTINCT name FROM settings WHERE name GLOB ?").all(accountPrefix + "*");
      for (const { name } of names) {
        if (gone(name.slice(accountPrefix.length))) db.run("DELETE FROM settings WHERE name=?", [name]);
      }
    }).immediate();
    this.lastSweep.set(session, { signature, at: now });
  }
}
