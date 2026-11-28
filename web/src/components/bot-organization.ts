import { useEffect, useRef, useState, type RefObject } from "react";
import { identityOf } from "./bot-identity";
import { useBotFeatured } from "@/lib/bot-featured";
import { forgetBot, saveBot } from "@/lib/bot-identity";
import { actOnBot, fetchChatOrder, placeChat, placeWorkspace } from "@/lib/api";
import { describeThrownError } from "@/lib/api-error-message";
import { chatOrderId, type ChatOrder } from "@/lib/chat-order";
import type { Scope } from "@/lib/scope";
import type { AgentView } from "@/lib/types";
import { useBotDrag, type Drop } from "./bot-drag";
import type { WorkspaceChoice } from "./bot-workspace-menu";

export const sectionKey = (scope: Scope, id: string) => JSON.stringify([scope.host, scope.session, id]);
export const dragScope = (scope: Scope) => JSON.stringify([scope.host, scope.session]);

async function move(space: WorkspaceChoice, before: string | null) {
  const result = await placeWorkspace(space.scope, space.id, before);
  if (!result.ok) throw new Error(result.error);
}

export function useBotOrganization(groups: Map<string, WorkspaceChoice & { rows: AgentView[] }>,
  list: RefObject<HTMLDivElement | null>, enabled: boolean, refresh: () => void) {
  const [order, setOrder] = useState<Map<string, string[]>>(new Map());
  const { clearFeatured } = useBotFeatured();
  const [menu, setMenu] = useState<WorkspaceChoice | null>(null);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const revision = useRef(0);
  // One order read per addressed mux, including when a read-only device opens the list.
  const scopes = JSON.stringify([...new Set(Array.from(groups.values(), g => dragScope(g.scope)))].toSorted());
  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      if (document.hidden || locked.current) return;
      const started = revision.current;
      const keys: string[] = JSON.parse(scopes);
      await Promise.all(keys.map(async key => {
        const [host, session]: [string | null, string | null] = JSON.parse(key);
        const scope = { host: host ?? undefined, session: session ?? undefined };
        try {
          const rows = await fetchChatOrder(scope, controller.signal);
          if (!Array.isArray(rows) || controller.signal.aborted || started !== revision.current || locked.current) return;
          setOrder(current => {
            const next = new Map(current);
            for (const row of rows) next.set(sectionKey(scope, row.workspaceId), row.paneIds);
            return next;
          });
        } catch { /* Cached topology remains usable while the bridge reconnects. */ }
      }));
    }
    void read();
    const interval = setInterval(() => { void read(); }, 15000);
    document.addEventListener("visibilitychange", read);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener("visibilitychange", read); };
  }, [scopes]);
  for (const [key, group] of groups) {
    const saved = order.get(key);
    if (!saved) continue;
    const rank = new Map(saved.map((id, i) => [id, i]));
    group.rows.sort((a, b) => (rank.get(chatOrderId(a)) ?? Infinity) - (rank.get(chatOrderId(b)) ?? Infinity));
  }
  async function apply(drop: Drop) {
    const space = groups.get(drop.source), target = groups.get(drop.target);
    if (!enabled || locked.current || !space || !target || dragScope(space.scope) !== dragScope(target.scope)) return;
    locked.current = true;
    setError("");
    revision.current++;
    let transferred = false;
    try {
      if (!drop.pane) {
        if (space !== target) await move(space, drop.before ? groups.get(drop.before)!.id : null);
      } else {
        const pane = space.rows.find(p => p.terminalId === drop.pane);
        if (!pane?.terminalId) return;
        if (drop.trash) {
          await actOnBot("trash", pane, space.scope);
          clearFeatured(pane);
          return;
        }
        if (space !== target) {
          const portrait = identityOf(pane, space.scope);
          await actOnBot("move", pane, space.scope, target.id);
          clearFeatured(pane);
          saveBot(space.scope, pane.terminalId, portrait);
          if (pane.paneId !== pane.terminalId) forgetBot(space.scope, pane.paneId);
          transferred = true;
        }
        const saved: ChatOrder = await placeChat(target.scope, target.id, drop.pane, drop.before);
        setOrder(current => new Map(current).set(drop.target, saved.paneIds));
      }
    } catch (err) {
      setError((transferred ? "El chat se movió, pero no se guardó la posición. " : "") + describeThrownError(err));
    } finally {
      locked.current = false;
      refresh();
    }
  }
  const openMenu = (key: string) => { if (enabled && !locked.current) setMenu(groups.get(key) ?? null); };
  const dragging = useBotDrag(list, enabled, drop => { void apply(drop); }, openMenu);
  const space = menu && (groups.get(sectionKey(menu.scope, menu.id)) ?? menu);
  return { dragging, error, openMenu, menu: space && enabled ? {
    space, spaces: [...groups.values()].filter(s => s.id !== "agent-runs" && dragScope(s.scope) === dragScope(space.scope)),
    move: (before: string | null) => move(space, before), refresh, close: () => setMenu(null),
    clearFeatured: () => { for (const pane of groups.get(sectionKey(space.scope, space.id))?.rows ?? []) clearFeatured(pane); },
  } : null };
}
