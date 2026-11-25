import { useState } from "react";

import { useMuxCapability } from "@/lib/mux-capability";
import { SectionHeader } from "@/components/section-header";
import { StatusDot } from "@/components/status-badge";
import { filterSpaces, spaceTriageMap } from "@/lib/spaces";
import type { Scope } from "@/lib/scope";
import type { AgentView, WorkspaceView } from "@/lib/types";
import { t, tn } from "@/lib/i18n";
import { useLocale } from "@/hooks/use-locale";
import { WorkspaceList, WorkspaceNewSpaceButton } from "@/components/workspace-list";

interface SpaceOverviewProps {
  workspaces: WorkspaceView[];
  agents: AgentView[];
  /** Bare shells too — a space you only ever opened a shell in still counts as used. */
  shellPanes?: AgentView[];
  onOpen: (workspaceId: string) => void;
  onNewSpace: () => void;
  /** True while a Space create is in flight — see `space-strip.tsx`'s prop of the same name. */
  creatingSpace?: boolean;
  /**
   * The machine these workspaces belong to — the ADDRESSED host (`?h=`, or the lead absent one),
   * since `workspaces` is already narrowed to it by the loader's `ambientSpaces`. Undefined on a
   * solo install. Without it, a peer's `w1` would pour its triage dot and its last-seen time into
   * another host's `w1` row (lib/spaces.ts).
   */
  host?: string;
  /** Fold state, owned by the dashboard so it can be persisted. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The address the dashboard shows, machine and session: the "+" asks it whether a space can be made
   * there (M55). Omit and the lead's primary session is asked, as before.
   */
  scope?: Scope;
}

// The dashboard's navigator: everything you might act on comes first. The program sessions are not
// listed here; they have the dashboard's Programs section (M55 spec 13, `program-section.tsx`). It
// folds to a single line, which with 45 spaces is the difference between a dashboard and a scroll, and
// expands to a filterable list in the multiplexer's own space order.
// A module-level empty list, not a `= []` default in the parameter list: a fresh array literal on
// every render is a new reference, which defeats memoisation downstream for no benefit here.
const NO_PANES: AgentView[] = [];

export function SpaceOverview({
  workspaces,
  agents,
  shellPanes = NO_PANES,
  onOpen,
  onNewSpace,
  creatingSpace = false,
  host,
  open,
  onOpenChange,
  scope,
}: SpaceOverviewProps) {
  // Ephemeral view state, like SpaceRoute's tab selection — a filter you typed yesterday should not
  // greet you today with most of your spaces missing.
  useLocale();
  const [query, setQuery] = useState("");
  // Whether this multiplexer can open a new space at all. See the two decision sites below.
  const newSpace = useMuxCapability("createSpace", scope);

  // One pass for "what's the most urgent thing in each space", shared with the chips so a row and a
  // chip can never mean different things by the same colour (lib/spaces.ts).
  const worstBySpace = spaceTriageMap(agents);
  const blockedSpaces = [...worstBySpace.values()].filter((b) => b === "needs").length;
  const visibleCount = query.trim() ? filterSpaces(workspaces, query).length : workspaces.length;

  return (
    <section className="flex flex-col gap-2 px-4 py-4">
      <SectionHeader
        label={t("space.overview.title")}
        // While filtering, the count reports what you can SEE — a header reading (45) above four
        // rows makes you doubt the filter rather than trust it.
        count={visibleCount}
        open={open}
        onToggle={onOpenChange}
        controls="spaces-body"
        trailing={
          <>
            {/* Why you'd bother expanding — stays visible while folded. */}
            {blockedSpaces > 0 && (
              <span
                className="flex items-center gap-1 text-[11px] font-semibold tabular-nums text-status-blocked"
                aria-label={tn("space.overview.needsYou", blockedSpaces)}
              >
                <StatusDot status="blocked" className="size-2.5" />
                {blockedSpaces}
              </span>
            )}
            {/* HIDDEN, and explained one line further down (M10/06). An icon has nowhere to put a
                sentence, and a "+" that always refuses is worse than no "+" at all — the pane sheet
                makes the same argument about greying out a control that cannot work. But an
                operator looking at a list of spaces WILL go looking for how to add one, so the
                reason cannot simply vanish with the button: it moves into the body, where there is
                room for words. Present on Herdr, which declares the capability. */}
            {newSpace.capable && <WorkspaceNewSpaceButton onNewSpace={onNewSpace} creating={creatingSpace} />}
          </>
        }
      />

      {open && (
        <WorkspaceList
          id="spaces-body"
          workspaces={workspaces}
          agents={agents}
          shellPanes={shellPanes}
          query={query}
          onQueryChange={setQuery}
          onOpen={onOpen}
          host={host}
          createNote={!newSpace.capable ? newSpace.note : ""}
        />
      )}
    </section>
  );
}
