import { useMemo, useState } from "react";

import { AgentTile } from "@/components/agent-tile";
import { Icon } from "@/components/icons/icon";
import { StatusDot } from "@/components/status-badge";
import { timeAgoShort } from "@/lib/format";
import { paneRowKey, spaceKey } from "@/lib/hosts";
import { t } from "@/lib/i18n";
import { activityAt } from "@/lib/pane-order";
import { paneName } from "@/lib/pane-name";
import { shownStatus } from "@/lib/triage";
import { statusLabel, type AgentView, type WorkspaceView } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MobileAgentHubProps {
  panes: readonly AgentView[];
  workspaces: readonly WorkspaceView[];
  stale?: boolean;
  onOpen: (pane: AgentView, row?: HTMLElement) => void;
  onPress: (pane: AgentView) => void;
  onNew?: () => void;
}

/**
 * The compact dashboard is a conversation index, not Collie's operations dashboard squeezed onto a
 * phone. The bridge model stays untouched; this surface deliberately exposes only the two things a
 * thumb needs first: choose a workspace and open a chat. Everything else remains in the medium and
 * expanded layouts and in the chat's overflow menu.
 */
export function MobileAgentHub({ panes, workspaces, stale = false, onOpen, onPress, onNew }: MobileAgentHubProps) {
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const cards = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pane of panes) {
      const key = spaceKey(pane.host, pane.workspaceId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return workspaces.map((item) => {
      const key = spaceKey(item.host, item.workspaceId);
      return {
        item,
        key,
        count: counts.get(key) ?? 0,
      };
    });
  }, [panes, workspaces]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return panes
      .filter((pane) => workspace === null || spaceKey(pane.host, pane.workspaceId) === workspace)
      .filter((pane) => {
        if (needle === "") return true;
        return `${paneName(pane)} ${pane.workspaceLabel} ${pane.agent}`.toLocaleLowerCase().includes(needle);
      });
  }, [panes, query, workspace]);

  return (
    <div data-slot="mobile-agent-hub" className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="shrink-0 px-4 pb-3 pt-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t("conversations.title")}</h1>
          {onNew !== undefined && (
            <button
              type="button"
              onClick={onNew}
              aria-label={t("home.new.label")}
              className="grid size-12 shrink-0 place-items-center rounded-full bg-foreground text-background shadow-sm transition-transform active:scale-95"
            >
              <Icon name="new-agent" className="size-5" />
            </button>
          )}
        </div>

        <div aria-label={t("home.workspaceFilter.all")} data-slot="mobile-workspaces" className="-mx-4 mt-5 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setWorkspace(null)}
            aria-pressed={workspace === null}
            className={cn(
              "flex h-[4.75rem] min-w-36 snap-start flex-col justify-between rounded-2xl border p-3 text-left transition-colors",
              workspace === null ? "border-foreground bg-foreground text-background" : "border-border bg-card active:bg-muted",
            )}
          >
            <Icon name="files" className="size-5" />
            <span className="truncate text-sm font-semibold">{t("home.workspaceFilter.all")}</span>
          </button>
          {cards.map(({ item, key, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => setWorkspace(key)}
              aria-pressed={workspace === key}
              className={cn(
                "flex h-[4.75rem] min-w-40 max-w-52 snap-start flex-col justify-between rounded-2xl border p-3 text-left transition-colors",
                workspace === key ? "border-foreground bg-foreground text-background" : "border-border bg-card active:bg-muted",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <Icon name="folder" className="size-5" />
                <span className={cn("text-xs tabular-nums", workspace === key ? "text-background/65" : "text-muted-foreground")}>{count}</span>
              </div>
              <span className="truncate text-sm font-semibold">{item.label || item.workspaceId}</span>
            </button>
          ))}
        </div>

        <label className="mt-3 flex h-11 items-center gap-2 rounded-full bg-muted/70 px-4 focus-within:ring-2 focus-within:ring-ring">
          <Icon name="search" className="size-4 text-muted-foreground" />
          <span className="sr-only">{t("chat.card.search")}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("chat.card.search")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {visible.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-muted-foreground">{t("home.empty.noAgents")}</p>
        ) : (
          <ul className="space-y-1">
            {visible.map((pane) => {
              const status = shownStatus(pane);
              const when = activityAt(pane);
              return (
                <li key={paneRowKey(pane)}>
                  <button
                    type="button"
                    onPointerDown={() => onPress(pane)}
                    onClick={(event) => onOpen(pane, event.currentTarget)}
                    data-glide-origin="pane"
                    className="flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors active:bg-muted"
                  >
                    <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-muted">
                      {pane.kind === "shell" ? <Icon name="shell-pane" className="size-5 text-muted-foreground" /> : <AgentTile pane={pane} className="size-7" glide="tile" />}
                      {pane.kind !== "shell" && (
                        <StatusDot
                          status={status}
                          label={statusLabel(status)}
                          stale={stale}
                          backed
                          surface="bg-muted"
                          glide="dot"
                          className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full ring-2 ring-background"
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span data-glide="name" className="block truncate text-[15px] font-semibold leading-5">{paneName(pane)}</span>
                      <span className="mt-0.5 block truncate text-sm text-muted-foreground">{pane.workspaceLabel || pane.workspaceId}</span>
                    </span>
                    {when > 0 && <span className="shrink-0 self-start pt-1 text-xs tabular-nums text-muted-foreground">{timeAgoShort(when)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
