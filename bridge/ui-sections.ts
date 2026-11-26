import { Database } from "bun:sqlite";
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asJsonBoolean, asJsonObject, asJsonString, parseJson, parseJsonObject } from "../web/src/lib/json.ts";

const trash = "trash";
const accountPrefix = "bot-section:v1:";
let serial = 0;

function address(key: string) {
  const value = parseJson(key);
  if (!Array.isArray(value) || value.length !== 3 || JSON.stringify(value) !== key) return;
  const [host, session] = value;
  const id = asJsonString(value[2]);
  if ((host !== null && !asJsonString(host)) || (session !== null && !asJsonString(session)) || !id) return;
  return { host, session, id };
}

export function sectionChanges(raw: string): Map<string, boolean> | undefined {
  const input = parseJsonObject(raw);
  const changes = asJsonObject(input?.changes);
  if (!input || Object.keys(input).length !== 1 || !changes) return;
  const result = new Map<string, boolean>();
  for (const [key, value] of Object.entries(changes)) {
    const folded = asJsonBoolean(value);
    if (folded === undefined || key.length > 2048 || (key !== trash && !address(key))) return;
    result.set(key, folded);
  }
  return result;
}

/** One bridge owns this ledger. Synchronous read/modify/rename keeps concurrent device deltas in arrival order. */
export class UiSections {
  private users = new Map<string, Set<string>>();
  private readonly file: string;
  private readonly lastSweep = new Map<string, { ids: Set<string>; at: number }>();

  constructor(private readonly stateDir: string, readonly sso = false) {
    this.file = join(stateDir, "ui-sections.json");
    let content: string;
    try { content = readFileSync(this.file, "utf8"); }
    catch { return; }
    const raw = parseJsonObject(content);
    const users = raw?.version === 1 && asJsonObject(raw.users);
    if (!users) return;
    const loaded = new Map<string, Set<string>>();
    for (const [user, folded] of Object.entries(users)) {
      if (!Array.isArray(folded)) return;
      const keys = new Set<string>();
      for (const value of folded) {
        const key = asJsonString(value);
        if (!key || (key !== trash && !address(key))) return;
        keys.add(key);
      }
      loaded.set(user, keys);
    }
    this.users = loaded;
  }

  read(userId: string) {
    return { userId, folded: [...(this.users.get(userId) ?? [])] };
  }

  update(userId: string, changes: Map<string, boolean>) {
    const next = new Set(this.users.get(userId));
    let dirty = false;
    for (const [key, folded] of changes) {
      if (next.has(key) === folded) continue;
      if (folded) next.add(key);
      else next.delete(key);
      dirty = true;
    }
    if (dirty) this.save(new Map(this.users).set(userId, next));
    return this.read(userId);
  }

  private save(next: Map<string, Set<string>>) {
    const users = Object.fromEntries([...next].filter(([, keys]) => keys.size).map(([user, keys]) => [user, [...keys]]));
    const { stateDir } = this;
    const tmp = join(stateDir, `ui-sections.json.${process.pid}.${++serial}.tmp`);
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

  /** Only a successful, unfiltered mux census can retire its own workspace keys, including after a restart. */
  reconcile(session: string, primary: boolean, ids: Set<string>, recoverable: (id: string) => boolean) {
    const gone = (key: string) => {
      const addr = address(key);
      return addr && addr.host === null && (addr.session === session || (primary && addr.session === null)) &&
        !ids.has(addr.id) && !recoverable(addr.id);
    };
    const next = new Map(this.users);
    let dirty = false;
    for (const [user, keys] of this.users) {
      const keep = new Set([...keys].filter(key => !gone(key)));
      if (keep.size === keys.size) continue;
      next.set(user, keep);
      dirty = true;
    }
    if (dirty) this.save(next);

    // SSO's existing /api/user-settings transport owns per-subject writes in its settings table.
    // Reap through a complete bridge census, never a member's filtered browser inventory.
    if (!this.sso) return;
    const previous = this.lastSweep.get(session);
    const now = Date.now();
    if (previous && now - previous.at < 60_000 && ids.size === previous.ids.size && [...ids].every(id => previous.ids.has(id))) return;
    const path = join(this.stateDir, "sso-owners.sqlite");
    if (!existsSync(path)) return;
    using db = new Database(path, { readwrite: true });
    db.transaction(() => {
      const keys = db.query<{ name: string }, [string]>("SELECT DISTINCT name FROM settings WHERE name GLOB ?").all(accountPrefix + "*");
      for (const { name } of keys) {
        if (gone(name.slice(accountPrefix.length))) db.run("DELETE FROM settings WHERE name=?", [name]);
      }
    }).immediate();
    this.lastSweep.set(session, { ids, at: now });
  }
}
