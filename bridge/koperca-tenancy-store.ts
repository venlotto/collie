import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface TenantActor {
  sub: string;
  username: string;
  role: "admin" | "member" | "viewer";
}

export interface TenantTopology {
  spaces: readonly { spaceId: string }[];
  panes: readonly { spaceId: string; paneId: string; terminalId?: string; tabId?: string }[];
}

export class OwnerStore {
  private readonly db: Database;

  constructor(
    private readonly stateDir: string,
    private readonly legacy: string,
  ) {
    if (!legacy.trim()) throw new Error("Set COLLIE_LEGACY_OWNER_SUB before enabling SSO");
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const path = join(stateDir, "sso-owners.sqlite");
    this.db = new Database(path, { create: true });
    chmodSync(path, 0o600);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users(sub TEXT PRIMARY KEY, username TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS legacy(sub TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS imported(session TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS ownership(session TEXT, kind TEXT, id TEXT, sub TEXT NOT NULL,
        PRIMARY KEY(session,kind,id));
      CREATE TABLE IF NOT EXISTS settings(sub TEXT, name TEXT, value TEXT NOT NULL, PRIMARY KEY(sub,name));
      CREATE TABLE IF NOT EXISTS requests(sub TEXT, session TEXT, op TEXT, id TEXT, fingerprint TEXT NOT NULL,
        internal TEXT UNIQUE NOT NULL, PRIMARY KEY(sub,session,op,id));
    `);
    this.db
      .transaction(() => {
        const saved = this.db.query<{ sub: string }, []>("SELECT sub FROM legacy").get();
        if (saved && saved.sub !== legacy) throw new Error("Legacy owner differs from the persisted SSO owner");
        this.db.run("INSERT OR IGNORE INTO legacy VALUES (?)", [legacy]);
      })
      .immediate();
  }

  account(actor: TenantActor) {
    this.db.run(
      "INSERT INTO users VALUES (?,?) ON CONFLICT(sub) DO UPDATE SET username=excluded.username WHERE username<>excluded.username",
      [actor.sub, actor.username],
    );
  }

  ownedSessions(sub: string) {
    const rows = this.db
      .query<{ session: string }, [string]>("SELECT DISTINCT session FROM ownership WHERE sub=? AND kind='terminal' ORDER BY session")
      .all(sub);
    return rows.map((row) => row.session);
  }

  hasAccount(sub: string) {
    return this.db.query("SELECT 1 FROM users WHERE sub=?").get(sub) !== null;
  }

  accounts() {
    return this.db.query<{ sub: string; username: string }, []>("SELECT sub,username FROM users ORDER BY username").all();
  }

  preferencesDir(sub: string) {
    if (sub === this.legacy) return this.stateDir;
    const dir = join(this.stateDir, "sso-users", createHash("sha256").update(sub).digest("hex"));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  settings(sub: string): Record<string, string> {
    const rows = this.db.query<{ name: string; value: string }, [string]>("SELECT name,value FROM settings WHERE sub=?").all(sub);
    return Object.fromEntries(rows.map((row) => [row.name, row.value]));
  }

  patch(sub: string, set: Record<string, string>, remove: string[]) {
    return this.db
      .transaction(() => {
        const next = new Map(Object.entries(this.settings(sub)));
        for (const name of remove) next.delete(name);
        for (const [name, value] of Object.entries(set)) next.set(name, value);
        if (next.size > 1024 || Buffer.byteLength(JSON.stringify(Object.fromEntries(next))) > 1024 * 1024) return false;
        for (const name of remove) this.db.run("DELETE FROM settings WHERE sub=? AND name=?", [sub, name]);
        for (const [name, value] of Object.entries(set)) this.db.run("INSERT OR REPLACE INTO settings VALUES (?,?,?)", [sub, name, value]);
        return true;
      })
      .immediate();
  }

  private assign(session: string, kind: "space" | "terminal", id: string, sub: string) {
    this.db.run("INSERT OR IGNORE INTO ownership VALUES (?,?,?,?)", [session, kind, id, sub]);
  }

  bootstrap(session: string, state: TenantTopology) {
    this.db
      .transaction(() => {
        if (this.db.query("SELECT 1 FROM imported WHERE session=?").get(session)) return;
        for (const item of state.spaces) this.assign(session, "space", item.spaceId, this.legacy);
        for (const item of state.panes) if (item.terminalId) this.assign(session, "terminal", item.terminalId, this.legacy);
        this.db.run("INSERT INTO imported VALUES (?)", [session]);
      })
      .immediate();
  }

  owner(session: string, kind: "space" | "terminal", id: string) {
    return this.db
      .query<{ sub: string }, [string, string, string]>("SELECT sub FROM ownership WHERE session=? AND kind=? AND id=?")
      .get(session, kind, id)?.sub;
  }

  claim(session: string, space: string, terminal: string, sub: string, newSpace: boolean) {
    return this.db
      .transaction(() => {
        const spaceOwner = this.owner(session, "space", space);
        const paneOwner = this.owner(session, "terminal", terminal);
        if ((spaceOwner !== sub && !(newSpace && !spaceOwner)) || (paneOwner && paneOwner !== sub)) return false;
        this.assign(session, "space", space, sub);
        this.assign(session, "terminal", terminal, sub);
        return true;
      })
      .immediate();
  }

  transfer(session: string, space: string, terminals: string[], sub: string) {
    return this.db
      .transaction(() => {
        if (!this.db.query("SELECT 1 FROM users WHERE sub=?").get(sub)) return false;
        this.db.run("INSERT OR REPLACE INTO ownership VALUES (?,?,?,?)", [session, "space", space, sub]);
        for (const terminal of terminals)
          this.db.run("INSERT OR REPLACE INTO ownership VALUES (?,?,?,?)", [session, "terminal", terminal, sub]);
        return true;
      })
      .immediate();
  }

  clientSendId(sub: string, session: string, terminal: string, internal: string | undefined) {
    if (!internal) return undefined;
    return this.db
      .query<{ id: string }, [string, string, string, string]>("SELECT id FROM requests WHERE sub=? AND session=? AND op=? AND internal=?")
      .get(sub, session, "send:" + terminal, internal)?.id;
  }

  sendReference(sub: string, session: string, terminal: string, id: string | undefined) {
    if (!id) return undefined;
    return this.db
      .query<
        { internal: string },
        [string, string, string, string, string]
      >("SELECT internal FROM requests WHERE sub=? AND session=? AND op=? AND (id=? OR internal=?)")
      .get(sub, session, "send:" + terminal, id, id)?.internal;
  }

  // The bridge's create-receipt book predates tenancy and is keyed solely by request id.
  // Reserve an unrelated id before dispatch so retries can never replay a different user's pane.
  requestId(sub: string, session: string, op: string, id: string, fingerprint: string) {
    return this.db
      .transaction(() => {
        this.db.run("INSERT OR IGNORE INTO requests VALUES (?,?,?,?,?,?)", [sub, session, op, id, fingerprint, randomUUID()]);
        const saved = this.db
          .query<
            { internal: string; fingerprint: string },
            [string, string, string, string]
          >("SELECT internal,fingerprint FROM requests WHERE sub=? AND session=? AND op=? AND id=?")
          .get(sub, session, op, id);
        return saved?.fingerprint === fingerprint ? saved.internal : undefined;
      })
      .immediate();
  }
}
