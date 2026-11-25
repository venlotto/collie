import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { ChatOrder } from "../web/src/lib/chat-order.ts";

export class ChatOrderStore {
  constructor(private readonly stateDir: string) {}

  private open() {
    mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    const path = join(this.stateDir, "chat-order.sqlite");
    const db = new Database(path, { create: true });
    chmodSync(path, 0o600);
    db.exec("CREATE TABLE IF NOT EXISTS positions (session TEXT, workspace TEXT, pane TEXT, position INTEGER, PRIMARY KEY(session,workspace,pane))");
    return db;
  }

  read(session: string): ChatOrder[] {
    if (!existsSync(join(this.stateDir, "chat-order.sqlite"))) return [];
    using db = this.open();
    const rows = db.query<{ workspace: string; pane: string }, [string]>(
      "SELECT workspace,pane FROM positions WHERE session=? ORDER BY workspace,position",
    ).all(session);
    const groups = new Map<string, string[]>();
    for (const row of rows) {
      if (!groups.has(row.workspace)) groups.set(row.workspace, []);
      groups.get(row.workspace)!.push(row.pane);
    }
    return Array.from(groups, ([workspaceId, paneIds]) => ({ workspaceId, paneIds }));
  }

  /** Insert relative to a live neighbour. A concurrent edit retains the other panes' order. */
  place(session: string, workspaceId: string, live: string[], paneId: string, before: string | null): ChatOrder {
    if (!live.includes(paneId) || (before !== null && (!live.includes(before) || paneId === before))) {
      throw new RangeError("La lista cambió. Vuelve a arrastrar el chat.");
    }
    using db = this.open();
    return db.transaction(() => {
      const saved = db.query<{ pane: string }, [string, string]>(
        "SELECT pane FROM positions WHERE session=? AND workspace=? ORDER BY position",
      ).all(session, workspaceId);
      const present = new Set(live);
      const panes = new Set(saved.map(row => row.pane).filter(id => present.has(id)));
      for (const id of live) panes.add(id);
      panes.delete(paneId);
      const paneIds = Array.from(panes);
      paneIds.splice(before === null ? paneIds.length : paneIds.indexOf(before), 0, paneId);
      db.run("DELETE FROM positions WHERE session=? AND workspace=?", [session, workspaceId]);
      const put = db.prepare("INSERT INTO positions VALUES (?,?,?,?)");
      paneIds.forEach((id, i) => put.run(session, workspaceId, id, i));
      return { workspaceId, paneIds };
    }).immediate();
  }
}
