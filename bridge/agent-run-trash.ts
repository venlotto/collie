import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { TRASH_RETENTION, type BotAction } from "./bot-trash.ts";

export interface RunPlacement {
  workspace: string;
  trashedAt: number | null;
  purged: number;
  terminalId: string | null;
}

/** A run's conversation outlives its terminal and continuation processes. Keep its placement by root id.
 * Purge leaves a tombstone: runner-owned status files and journals must not bring the bot back. */
export class AgentRunTrash {
  constructor(private readonly stateDir: string, private readonly now = Date.now) {}

  private open() {
    mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    const path = join(this.stateDir, "agent-run-trash.sqlite");
    const db = new Database(path, { create: true });
    chmodSync(path, 0o600);
    db.exec("CREATE TABLE IF NOT EXISTS placements (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, trashedAt INTEGER, purged INTEGER NOT NULL DEFAULT 0, terminalId TEXT)");
    return db;
  }

  read(): Map<string, RunPlacement> {
    if (!existsSync(join(this.stateDir, "agent-run-trash.sqlite"))) return new Map();
    using db = this.open();
    return new Map(db.query<RunPlacement & { id: string }, []>("SELECT * FROM placements").all().map(row => [row.id, row]));
  }

  expired(row: RunPlacement): boolean {
    return row.trashedAt !== null && this.now() - row.trashedAt >= TRASH_RETENTION;
  }

  act(id: string, action: BotAction, currentWorkspace: string, workspace?: string, trashedAt?: number, terminalId?: string) {
    using db = this.open();
    db.transaction(() => {
      const old = db.query<RunPlacement, [string]>("SELECT * FROM placements WHERE id=?").get(id);
      const inTrash = action === "restore" || action === "purge";
      if (old?.purged || (inTrash && (old?.trashedAt == null || old.trashedAt !== trashedAt)) ||
          (!inTrash && old?.trashedAt != null) || (action === "restore" && old && this.expired(old))) {
        throw new Error("La selección de Papelera ha cambiado.");
      }
      const destination = workspace ?? old?.workspace ?? currentWorkspace;
      db.run("INSERT OR REPLACE INTO placements VALUES (?,?,?,?,?)", [id, destination,
        action === "trash" ? this.now() : action === "purge" ? old!.trashedAt : null, action === "purge" ? 1 : 0, old?.terminalId ?? terminalId ?? null]);
    }).immediate();
  }
}
