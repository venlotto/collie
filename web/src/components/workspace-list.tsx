import { Fragment, type ReactNode } from "react";

import { BranchLabel } from "@/components/ui/branch-label";
import { CrossfadeText } from "@/components/ui/crossfade-text";
import { Icon } from "@/components/icons/icon";
import { StatusDot } from "@/components/status-badge";
import { LIST_ROW_CORNERS, ListGroup } from "@/components/ui/list-group";
import { SQUARE_36_TAP_TARGET } from "@/components/ui/tap-target";
import { timeAgo } from "@/lib/format";
import { spaceKey } from "@/lib/hosts";
import { t, tn } from "@/lib/i18n";
import { shortcutTarget } from "@/lib/shortcuts/target";
import {
  filterSpaces,
  nestWorktrees,
  spaceLastSeenMap,
  spaceTriageMap,
  spaceWorktreeContext,
  type WorktreeContext,
} from "@/lib/spaces";
import { TRIAGE_STATUS } from "@/lib/triage";
import { statusLabel, type AgentView, type WorkspaceView } from "@/lib/types";
import { cn } from "@/lib/utils";

const NO_PANES: AgentView[] = [];

export interface WorkspaceListProps {
  workspaces: WorkspaceView[];
  agents: AgentView[];
  /** Bare shells count when the list stamps a workspace's last-seen time. */
  shellPanes?: AgentView[];
  /** Ephemeral search text, owned by the surface embedding the list. */
  query: string;
  onQueryChange: (query: string) => void;
  onOpen: (workspaceId: string) => void;
  /** The addressed host; workspace ids repeat across a crew. */
  host?: string;
  /** Why creation is unavailable, rendered where a person looking for it will read it. */
  createNote?: string;
  /** Stable id for the list region. SpaceOverview keeps its historical `spaces-body`. */
  id?: string;
}

/**
 * A reusable workspace navigator body: search, fixed mux order, worktree nesting, state marks,
 * last-seen times, pane counts and empty answers. The surrounding surface owns its heading and
 * creation control, so the same rows can stand in the dashboard or in a sheet without a box in a box.
 */
export function WorkspaceList({
  workspaces,
  agents,
  shellPanes = NO_PANES,
  query,
  onQueryChange,
  onOpen,
  host,
  createNote = "",
  id,
}: WorkspaceListProps) {
  const panes = [...agents, ...shellPanes];
  // One pass over the panes, then map lookups — this component re-renders on every poll.
  const lastSeen = spaceLastSeenMap(panes);
  // One pass for "what's the most urgent thing in each space", shared with the chips so a row and a
  // chip can never mean different things by the same colour (lib/spaces.ts).
  const worstBySpace = spaceTriageMap(agents);
  // SPACE NUMBER ORDER, which is the multiplexer's own, and the SAME order the space strip shows.
  // Recency remains a fact on the row, never an ordering input.
  const visible = filterSpaces(workspaces, query);
  // Worktrees sit under the space holding their repo — but NOT while filtering: a child without its
  // parent on screen must not keep an indentation whose cause is invisible.
  const rows = query.trim()
    ? visible.map((space) => ({ space, depth: 0 as const }))
    : nestWorktrees(visible);

  return (
    <ListGroup id={id}>
      {createNote !== "" && (
        <p className="px-3.5 py-2 text-xs leading-snug text-muted-foreground">{createNote}</p>
      )}

      {/* Deliberately not autofocused: opening a workspace surface must not throw the keyboard over it. */}
      {workspaces.length > 1 && (
        <label className="sticky top-0 z-10 flex items-center gap-2 rounded-t-[var(--row-top,0px)] bg-background px-3.5 py-2">
          <Icon name="search" className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("space.overview.filter.placeholder")}
            aria-label={t("space.overview.filter.aria")}
            className="min-h-9 min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </label>
      )}

      {workspaces.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-sm text-muted-foreground">
          {t("space.overview.empty.none")}
        </p>
      ) : visible.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-sm text-muted-foreground">
          {t("space.overview.empty.noMatch", { query })}
        </p>
      ) : (
        rows.map(({ space: workspace, depth }) => {
          const key = spaceKey(host, workspace.workspaceId);
          const bucket = worstBySpace.get(key);
          const status = bucket ? TRIAGE_STATUS[bucket] : null;
          const blocked = bucket === "needs";
          const seen = lastSeen.get(key) ?? 0;
          const context = spaceWorktreeContext(workspace, depth === 1);
          return (
            <button
              key={workspace.workspaceId}
              type="button"
              onClick={() => onOpen(workspace.workspaceId)}
              className={cn(
                "w-full text-left transition-colors active:scale-[0.99]",
                LIST_ROW_CORNERS,
                !blocked && "hover:bg-muted/50",
                depth === 1 && "pl-5",
              )}
            >
              <div
                className={cn(
                  "flex flex-row items-center gap-3 px-3.5 py-2.5 shadow-[var(--edge-accent)_transparent]",
                  LIST_ROW_CORNERS,
                  blocked &&
                    "bg-status-blocked/5 shadow-[var(--edge-accent)_var(--color-status-blocked),var(--edge-shadow)]",
                )}
              >
                {status ? (
                  <>
                    <StatusDot status={status} className="size-2.5" />
                    <span className="sr-only">{statusLabel(status)}</span>
                  </>
                ) : (
                  <span className="size-2.5 shrink-0 rounded-full border border-muted-foreground/40" />
                )}
                {context === null ? (
                  <span className="min-w-0 flex-1 truncate font-medium">
                    <CrossfadeText text={workspace.label} identity={key} />
                  </span>
                ) : (
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">
                      <CrossfadeText text={workspace.label} identity={key} />
                    </span>
                    <WorktreeLine context={context} />
                  </span>
                )}
                {seen > 0 && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {timeAgo(seen)}
                  </span>
                )}
                <span
                  aria-label={tn("space.overview.paneCount", workspace.paneCount)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground"
                >
                  <Icon name="pane-count" className="size-3.5" aria-hidden />
                  {workspace.paneCount}
                </span>
              </div>
            </button>
          );
        })
      )}
    </ListGroup>
  );
}

export function WorkspaceNewSpaceButton({
  onNewSpace,
  creating = false,
}: {
  onNewSpace: () => void;
  creating?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onNewSpace}
      disabled={creating}
      aria-label={t("space.overview.new.aria")}
      {...shortcutTarget("new_space")}
      aria-busy={creating}
      className={cn(
        "flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 disabled:opacity-100",
        SQUARE_36_TAP_TARGET,
      )}
    >
      {creating ? (
        <Icon name="busy" className="size-4 animate-spin" aria-hidden />
      ) : (
        <Icon name="new-space" className="size-4" />
      )}
    </button>
  );
}

function WorktreeLine({ context }: { context: WorktreeContext }) {
  const parts: { key: string; node: ReactNode }[] = [];
  if (context.repo !== null) {
    parts.push({ key: "repo", node: <span className="min-w-0 shrink truncate">{context.repo}</span> });
  }
  if (context.head !== null) {
    parts.push({ key: "head", node: <BranchLabel head={context.head} className="shrink" /> });
  }
  if (context.base !== null) {
    parts.push({
      key: "base",
      node: <span className="min-w-0 max-w-[40%] shrink-0 truncate">{t("space.worktree.fromBase", { base: context.base })}</span>,
    });
  }
  return (
    <span data-slot="space-row-worktree" className="flex h-4 min-w-0 items-center gap-1 text-xs text-muted-foreground">
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {index > 0 && (
            <span className="shrink-0 text-muted-foreground/60" aria-hidden>
              ·
            </span>
          )}
          {part.node}
        </Fragment>
      ))}
    </span>
  );
}
