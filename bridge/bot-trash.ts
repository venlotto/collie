import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asJsonObject, asJsonString, asJsonNumber, parseJson } from "../web/src/lib/json.ts";
import type { MuxAdapter, MuxPane, MuxSnapshot } from "./mux/types.ts";

export const TRASH_INTERVAL = 60 * 60 * 1000;
export const TRASH_RETENTION = 7 * 24 * TRASH_INTERVAL;
export type BotAction = "move" | "trash" | "restore" | "purge";

interface Entry {
  session: string;
  terminalId: string;
  originalWorkspaceId: string;
  trashedAt: number;
  deleting?: true;
}
type Target = { herdr: MuxAdapter; engine: { pokeNow(): void } };
const key = (session: string, terminalId: string) => JSON.stringify([session, terminalId]);

/** New attachments carry a collision-free owner across sessions and pane renumbering. */
export function botUploadPrefix(session: string, terminalId: string): string {
  return "term." + createHash("sha256").update(key(session, terminalId)).digest("hex") + ".";
}

export class BotTrash {
  private readonly file: string;
  private rows = new Map<string, Entry>();
  private lane = Promise.resolve();
  constructor(private dir: string, private runtime: (session: string) => Target | undefined, private now = Date.now) {
    this.file = join(dir, "bot-trash.json");
    if (!existsSync(this.file)) return;
    const saved = parseJson(readFileSync(this.file, "utf8"));
    if (!Array.isArray(saved)) throw new Error("Invalid bot trash file");
    for (const value of saved) {
      const obj = asJsonObject(value);
      const session = asJsonString(obj?.session);
      const terminalId = asJsonString(obj?.terminalId);
      const originalWorkspaceId = asJsonString(obj?.originalWorkspaceId);
      const trashedAt = asJsonNumber(obj?.trashedAt);
      if (!session || !terminalId || !originalWorkspaceId || !trashedAt || !Number.isSafeInteger(trashedAt) || trashedAt < 0 ||
          (obj?.deleting !== undefined && obj.deleting !== true)) throw new Error("Invalid bot trash entry");
      const row: Entry = { session, terminalId, originalWorkspaceId, trashedAt };
      if (obj?.deleting) row.deleting = true;
      this.rows.set(key(session, terminalId), row);
    }
  }

  lookup(session: string, terminalId: string) {
    const row = this.rows.get(key(session, terminalId));
    if (row) return { originalWorkspaceId: row.originalWorkspaceId, trashedAt: row.trashedAt };
    return undefined;
  }

  private save(session: string, terminalId: string, entry?: Entry) {
    const next = new Map(this.rows);
    const id = key(session, terminalId);
    if (entry) next.set(id, entry);
    else next.delete(id);
    if (next.size) {
      const tmp = this.file + ".tmp";
      writeFileSync(tmp, JSON.stringify([...next.values()]), { mode: 0o600 });
      renameSync(tmp, this.file);
    } else rmSync(this.file, { force: true });
    this.rows = next;
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.lane.then(work);
    this.lane = pending.then(() => undefined, () => undefined);
    return pending;
  }

  act(session: string, action: BotAction, terminalId: string, workspaceId?: string, trashedAt?: number) {
    return this.serialize(async () => {
      const rt = this.runtime(session);
      if (!rt?.herdr.movePane) throw new Error("Esta sesión no admite mover chats.");
      const mux = rt.herdr;
      const row = this.rows.get(key(session, terminalId));
      const inTrash = action === "restore" || action === "purge";
      if (inTrash && (!row || row.trashedAt !== trashedAt)) throw new Error("La selección de Papelera ha cambiado.");
      if ((!inTrash && row) || (row?.deleting && action !== "purge")) throw new Error("El chat ya está en Papelera.");
      const snapshot = await mux.snapshot();
      const pane = snapshot.panes.find(p => p.terminalId === terminalId);
      if (action === "purge" && row) {
        // Persist intent before closing. A crash after the mux write resumes cleanup only.
        if (!row.deleting) this.save(session, terminalId, { ...row, deleting: true });
        if (pane) await this.closeTrashedPane(mux, terminalId, pane, snapshot);
        this.cleanUploads(session, terminalId);
        this.save(session, terminalId);
        rt.engine.pokeNow();
        return;
      }
      if (!pane) throw new Error("El chat ya no está disponible.");
      if (action === "trash") {
        this.save(session, terminalId, { session, terminalId, originalWorkspaceId: pane.spaceId, trashedAt: this.now() });
      } else {
        const destination = workspaceId ?? row?.originalWorkspaceId;
        if (!destination || !snapshot.spaces.some(w => w.spaceId === destination)) throw new Error("Elige un workspace disponible.");
        if (pane.spaceId !== destination) await rt.herdr.movePane(pane.paneId, destination);
        if (action === "restore") this.save(session, terminalId);
      }
      rt.engine.pokeNow();
    });
  }

  private async closeTrashedPane(mux: MuxAdapter, terminalId: string, pane: MuxPane, snapshot: MuxSnapshot) {
    // Herdr drops the workspace with its last pane. The user selected chats, never the workspace.
    if (snapshot.panes.filter(p => p.spaceId === pane.spaceId).length === 1) {
      const kept = await mux.createTab({ spaceId: pane.spaceId });
      if (!kept.ok) throw new Error("No se pudo conservar el workspace.");
    }
    const current = await mux.snapshot();
    const live = current.panes.find(p => p.terminalId === terminalId);
    if (!live) return;
    if (live.paneId !== pane.paneId || !current.panes.some(p => p.spaceId === live.spaceId && p.paneId !== live.paneId)) {
      throw new Error("El workspace cambió durante el cierre.");
    }
    const closed = await mux.closePane(live.paneId);
    if (!closed.ok) throw new Error("Herdr no confirmó el cierre.");
  }

  // Commit an attachment in the same lane as purge. A slow upload that finishes after
  // close cannot recreate files or attach itself to a replacement at the old pane address.
  writeAttachment<T>(session: string, paneId: string, expectedTerminal: string | undefined, write: (prefix: string) => Promise<T>) {
    return this.serialize(async () => {
      const rt = this.runtime(session);
      const snapshot = await rt?.herdr.snapshot();
      const owner = snapshot?.panes.find(p => p.paneId === paneId)?.terminalId;
      if (!owner || (expectedTerminal && owner !== expectedTerminal) || this.rows.get(key(session, owner))?.deleting) {
        throw new Error("El chat ya no admite adjuntos.");
      }
      return write(botUploadPrefix(session, owner));
    });
  }

  private cleanUploads(session: string, terminalId: string) {
    const uploads = join(this.dir, "uploads");
    if (!existsSync(uploads)) return;
    const prefix = botUploadPrefix(session, terminalId);
    for (const name of readdirSync(uploads)) {
      if (name.startsWith(prefix)) rmSync(join(uploads, name), { force: true });
    }
  }

  async sweep() {
    for (const row of this.rows.values()) {
      if (!row.deleting && this.now() - row.trashedAt < TRASH_RETENTION) continue;
      try {
        await this.act(row.session, "purge", row.terminalId, undefined, row.trashedAt);
      } catch {
        // A restore racing this sweep wins. An unavailable mux or failed unlink is retried next hour.
        if (this.lookup(row.session, row.terminalId)) console.warn("[bot-trash] pending purge will retry");
      }
    }
  }
}
