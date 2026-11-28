import { TRASH_RETENTION } from "../web/src/lib/trash-retention.ts";
import { ChatOrderStore } from "./chat-order.ts";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asJsonObject, asJsonString, asJsonNumber, parseJson } from "../web/src/lib/json.ts";
import type { MuxAdapter, MuxPane, MuxSnapshot } from "./mux/types.ts";

export const TRASH_INTERVAL = 15 * 1000;
export { TRASH_RETENTION } from "../web/src/lib/trash-retention.ts";
export type BotAction = "move" | "trash" | "restore" | "purge";

interface Entry {
  session: string;
  terminalId: string;
  originalWorkspaceId: string;
  trashedAt: number;
  deleting?: true;
  workspaceLabel?: string;
  previousTrash?: { originalWorkspaceId: string; trashedAt: number };
}
type Target = { herdr: MuxAdapter; engine: { pokeNow(): void } };
const key = (session: string, terminalId: string) => JSON.stringify([session, terminalId]);

/** New attachments carry a collision-free owner across sessions and pane renumbering. */
export function botUploadPrefix(session: string, terminalId: string): string {
  return "term." + createHash("sha256").update(key(session, terminalId)).digest("hex") + ".";
}

export class BotTrash {
  private rows = new Map<string, Entry>();
  private lane = Promise.resolve();
  private sweeping?: Promise<void>;
  constructor(private readonly stateDir: string, private runtime: (session: string) => Target | undefined, private now = Date.now) {
    const file = join(stateDir, "bot-trash.json");
    if (!existsSync(file)) return;
    const saved = parseJson(readFileSync(file, "utf8"));
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
      if (obj?.workspaceLabel !== undefined) {
        const label = asJsonString(obj.workspaceLabel);
        if (!label) throw new Error("Invalid workspace trash label");
        row.workspaceLabel = label;
      }
      if (obj?.previousTrash !== undefined) {
        const prev = asJsonObject(obj.previousTrash);
        const originalId = asJsonString(prev?.originalWorkspaceId);
        const at = asJsonNumber(prev?.trashedAt);
        if (!row.workspaceLabel || !originalId || !at || !Number.isSafeInteger(at) || at <= 0) throw new Error("Invalid prior trash entry");
        row.previousTrash = { originalWorkspaceId: originalId, trashedAt: at };
      }
      if (obj?.deleting) row.deleting = true;
      this.rows.set(key(session, terminalId), row);
    }
  }

  hasWorkspaceEntries(session: string, workspaceId: string): boolean {
    for (const row of this.rows.values()) {
      if (row.session === session && (row.originalWorkspaceId === workspaceId ||
          row.previousTrash?.originalWorkspaceId === workspaceId)) return true;
    }
    return false;
  }

  lookup(session: string, terminalId: string) {
    const row = this.rows.get(key(session, terminalId));
    if (!row) return undefined;
    const trash: Pick<Entry, "originalWorkspaceId" | "trashedAt" | "workspaceLabel"> = {
      originalWorkspaceId: row.originalWorkspaceId, trashedAt: row.trashedAt,
    };
    if (row.workspaceLabel !== undefined) trash.workspaceLabel = row.workspaceLabel;
    return trash;
  }

  private save(session: string, terminalId: string, entry?: Entry) {
    const next = new Map(this.rows);
    const id = key(session, terminalId);
    if (entry) next.set(id, entry);
    else next.delete(id);
    this.persist(next);
  }

  private persist(next: Map<string, Entry>) {
    const file = join(this.stateDir, "bot-trash.json");
    if (next.size) {
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify([...next.values()]), { mode: 0o600 });
      renameSync(tmp, file);
    } else rmSync(file, { force: true });
    this.rows = next;
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.lane.then(work);
    this.lane = pending.then(() => undefined, () => undefined);
    return pending;
  }

  workspace(session: string, action: "trashWorkspace" | "restoreWorkspace", workspaceId: string, trashedAt?: number) {
    return this.serialize(async () => {
      const rt = this.runtime(session);
      if (!rt?.herdr.movePane) throw new Error("Esta sesión no admite la Papelera de workspaces.");
      const snapshot = await rt.herdr.snapshot();
      const next = new Map(this.rows);
      if (action === "restoreWorkspace") {
        const group = [...next.values()].filter(r => r.session === session && r.originalWorkspaceId === workspaceId && r.workspaceLabel !== undefined);
        if (!group.length || trashedAt === undefined || this.now() - trashedAt >= TRASH_RETENTION || group.some(r => r.trashedAt !== trashedAt || r.deleting)) {
          throw new Error("La selección de Papelera ha cambiado.");
        }
        for (const row of group) {
          const pane = snapshot.panes.find(p => p.terminalId === row.terminalId);
          if (pane && pane.spaceId !== workspaceId) await rt.herdr.movePane(pane.paneId, workspaceId);
          const id = key(session, row.terminalId);
          if (row.previousTrash) next.set(id, { session, terminalId: row.terminalId, ...row.previousTrash });
          else next.delete(id);
        }
      } else {
        const space = snapshot.spaces.find(w => w.spaceId === workspaceId);
        const panes = snapshot.panes.filter(p => p.spaceId === workspaceId);
        if (!space || !panes.length) throw new Error("El workspace ya no está disponible.");
        const at = this.now();
        for (const pane of panes) {
          if (!pane.terminalId) throw new Error("No se pudo identificar uno de los chats.");
          const id = key(session, pane.terminalId);
          const old = next.get(id);
          if (old?.deleting || old?.workspaceLabel !== undefined) throw new Error("El workspace cambió en Papelera.");
          const member: Entry = { session, terminalId: pane.terminalId, originalWorkspaceId: workspaceId,
            workspaceLabel: space.label || workspaceId, trashedAt: at };
          if (old) member.previousTrash = { originalWorkspaceId: old.originalWorkspaceId, trashedAt: old.trashedAt };
          next.set(id, member);
        }
      }
      // All members enter or leave together, through the same atomic ledger write as a single chat.
      this.persist(next);
      rt.engine.pokeNow();
    });
  }

  act(session: string, action: BotAction, terminalId: string, workspaceId?: string, trashedAt?: number, expiry = false) {
    return this.serialize(async () => {
      const rt = this.runtime(session);
      if (!rt?.herdr.movePane) throw new Error("Esta sesión no admite mover chats.");
      const mux = rt.herdr;
      const row = this.rows.get(key(session, terminalId));
      if (row?.workspaceLabel !== undefined && !expiry) throw new Error("Restaura el workspace desde la Papelera.");
      const inTrash = action === "restore" || action === "purge";
      if (inTrash && (!row || row.trashedAt !== trashedAt)) throw new Error("La selección de Papelera ha cambiado.");
      if (action === "restore" && row && this.now() - row.trashedAt >= TRASH_RETENTION) throw new Error("El plazo para restaurar el chat ha vencido.");
      if ((!inTrash && row) || (row?.deleting && action !== "purge")) throw new Error("El chat ya está en Papelera.");
      const snapshot = await mux.snapshot();
      const pane = snapshot.panes.find(p => p.terminalId === terminalId);
      if (action === "purge" && row) {
        // Persist intent before closing. A crash after the mux write resumes cleanup only.
        if (!row.deleting) this.save(session, terminalId, { ...row, deleting: true });
        if (pane) await this.closeTrashedPane(mux, terminalId, pane, snapshot, row.workspaceLabel !== undefined && pane.spaceId === row.originalWorkspaceId);
        this.cleanUploads(session, terminalId);
        new ChatOrderStore(this.stateDir).forget(session, terminalId);
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

  private async closeTrashedPane(mux: MuxAdapter, terminalId: string, pane: MuxPane, snapshot: MuxSnapshot, removeEmptyWorkspace: boolean) {
    // Herdr drops the workspace with its last pane. Keep it for an individual chat deletion.
    if (!removeEmptyWorkspace && snapshot.panes.filter(p => p.spaceId === pane.spaceId).length === 1) {
      const kept = await mux.createTab({ spaceId: pane.spaceId });
      if (!kept.ok) throw new Error("No se pudo conservar el workspace.");
    }
    const current = await mux.snapshot();
    const live = current.panes.find(p => p.terminalId === terminalId);
    if (!live) return;
    if (live.paneId !== pane.paneId || (!removeEmptyWorkspace && !current.panes.some(p => p.spaceId === live.spaceId && p.paneId !== live.paneId))) {
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
    const uploads = join(this.stateDir, "uploads");
    if (!existsSync(uploads)) return;
    const prefix = botUploadPrefix(session, terminalId);
    for (const name of readdirSync(uploads)) {
      if (name.startsWith(prefix)) rmSync(join(uploads, name), { force: true });
    }
  }

  /** Background runs keep their own durable deletion record; close only their saved terminal. */
  purgeRunTerminal(session: string, terminalId: string) {
    return this.serialize(async () => {
      const rt = this.runtime(session);
      if (!rt) throw new Error("La sesión no está disponible para limpiar el chat.");
      const snapshot = await rt.herdr.snapshot();
      const pane = snapshot.panes.find(p => p.terminalId === terminalId);
      if (pane) await this.closeTrashedPane(rt.herdr, terminalId, pane, snapshot, false);
      this.cleanUploads(session, terminalId);
      new ChatOrderStore(this.stateDir).forget(session, terminalId);
      rt.engine.pokeNow();
    });
  }

  sweep(): Promise<void> {
    return this.sweeping ??= this.sweepExpired().finally(() => { this.sweeping = undefined; });
  }

  private async sweepExpired() {
    for (const row of this.rows.values()) {
      if (!row.deleting && this.now() - row.trashedAt < TRASH_RETENTION) continue;
      try {
        await this.act(row.session, "purge", row.terminalId, undefined, row.trashedAt, true);
      } catch (error) {
        // A restore racing this sweep wins. Failed cleanup is retried on the next tick.
        if (this.lookup(row.session, row.terminalId)) console.warn("[bot-trash] pending purge will retry", row.session, row.terminalId, error instanceof Error ? error.message : "unknown error");
      }
    }
  }
}
