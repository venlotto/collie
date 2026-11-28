import { t } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLoaderData, useLocation, useMatch, useParams } from "react-router";

import { isUnseen } from "@/lib/triage";
import { AgentChat } from "@/components/agent-chat";
import { WalkyLogProvider } from "@/components/walky-log";
import { FileLinksProvider, usePaneFileLinks } from "@/components/file-links";
import { SubagentSheet } from "@/components/subagent-sheet";
import { useLoadingStalled } from "@/hooks/use-loading-stalled";
import { useNav } from "@/hooks/use-nav";
import { usePaneFold } from "@/hooks/use-fold-posture";
import { useWidthClass } from "@/hooks/use-width-class";
import { type PaneData } from "@/lib/loaders";
import { homePath, panePath, zoomPath } from "@/lib/nav";
import { readAgentLaunch } from "@/lib/agent-startup";
import { paneScopeKey } from "@/lib/scope";
import { findPane, paneRowKey, paneScope } from "@/lib/hosts";
import { panePlaceParts } from "@/lib/pane-name";
import { clearDraft, loadDraftEntry, saveDraft } from "@/lib/drafts";
import { setStatus } from "@/lib/status";
import { rememberTabPane } from "@/lib/tab-pane-memory";
import { rememberRecentPane } from "@/lib/recent-panes";
import { useMuxCapability } from "@/lib/mux-capability";
import type { AgentView } from "@/lib/types";
import { useRootData } from "@/lib/route-data";

// Pane detail route. Pane output comes from this route's loader; the pane's metadata comes from the
// shared snapshot (root loader). The pane may be an agent OR a bare shell. A just-created shell
// isn't in the snapshot yet, so we fall back to the `freshPane` passed via navigation state — the
// composer stays live immediately while polling catches the snapshot up. Keyed by paneId so
// switching panes remounts the composer fresh.
export function DetailRoute() {
  // SAFETY: this is the `/pane/:paneId` route's element and `paneLoader` returns `PaneData`; the
  // element does not mount until that loader has resolved. React Router types a data-mode
  // `useLoaderData()` as `unknown`.
  const pane = useLoaderData() as PaneData;
  const { paneId = "" } = useParams();
  const location = useLocation();
  return <PaneScreen pane={pane} paneId={paneId} location={location} active />;
}

export function PaneScreen({ pane, paneId, location, active }: {
  pane: PaneData; paneId: string; location: ReturnType<typeof useLocation>; active: boolean;
}) {
  const root = useRootData();
  // The session this pane belongs to (undefined = primary), read from the pane loader so every
  // navigation and write below stays scoped to it.
  const scope = pane.scope;
  const nav = useNav();
  const stalled = useLoadingStalled();
  // From 600px wide the pane screen is a sidebar beside a strip of panes (ADR 0120). Below, nothing
  // here changes.
  const widthClass = useWidthClass();
  // A half-open foldable splits the screen at the fold (ADR 0120, "Folded postures"); flat elsewhere.
  const fold = usePaneFold(widthClass);

  // SAFETY: `location.state` is whatever the navigation that got here attached — `unknown` by
  // definition. Collie puts `{ freshPane }` there (components/agent-list's optimistic open), beside
  // an agent launch's intent, and the optional chain means any other state reads as "not carried".
  const fresh = (location.state as { freshPane?: AgentView } | null)?.freshPane;
  const inSnapshot =
    root.agents.some((a) => a.paneId === paneId) ||
    root.shellPanes.some((p) => p.paneId === paneId);
  // The freshPane is a bootstrap only — used before a just-created pane first appears in a snapshot.
  // Once it's been seen, retire it; otherwise the stale copy masks a pane that has since closed
  // (e.g. you ran `exit` in its shell), stranding you on a dead view.
  //
  // Track *which* pane has been seen, not just a boolean: DetailRoute doesn't remount on a pane→pane
  // navigation (only `key={paneId}` on AgentChat does), so a lifetime boolean would carry the prior
  // pane's "seen" state onto a freshly-created one — disabling its freshPane fallback before the
  // snapshot catches up, so `gone` flips true and the effect below bounces you Home. That's the
  // "create a tab from inside an open pane sends me home" bug.
  const seenPaneId = useRef<string | null>(null);
  if (inSnapshot) seenPaneId.current = paneId;
  const seen = seenPaneId.current === paneId;
  // A launch the phone started keeps Send gated until the agent's first screen is read (AgentChat).
  // Once it is, the intent is retired from this entry, so Back and Forward never gate the pane again.
  const agentLaunch = readAgentLaunch(location.state, paneId, scope);
  const launchReady = useCallback(() => {
    // SAFETY: the same `location.state` the launch above was read from; only its intent is dropped,
    // so the optimistic row stays and `side` carries `from` over.
    const state = location.state as { agentLaunch?: unknown; freshPane?: AgentView } | null;
    if (state?.agentLaunch === undefined) return;
    const { agentLaunch: _retired, ...rest } = state;
    nav.side(`${location.pathname}${location.search}`, rest);
  }, [location.state, location.pathname, location.search, nav]);

  // Looked up WITHIN the scope's host: `w1:p1` exists on every machine in a crew, so a match by id
  // alone could hand this view another machine's pane — rendering its space, tab and cwd around a
  // mirror of, and a composer typing into, the one the URL actually addresses. Solo panes carry no
  // host and match unconditionally, so this is the same lookup it has always been.
  //
  // Last, the pane's row from a herd the phone kept (`PaneData.savedPane`), and only while the herd on
  // screen is not a live answer. With the bridge away the root loader may hold no herd for this
  // pane's address (the dashboard's was widened, or another machine's), and the pane is then still
  // the pane the operator opened, drawn from what was saved. A live herd without the pane outranks
  // it: that is the one answer that may say the pane closed.
  const addressed =
    findPane(root.agents, paneId, scope, root.servers, root.sessions) ??
    findPane(root.shellPanes, paneId, scope, root.servers, root.sessions) ??
    (fresh && fresh.paneId === paneId && !seen ? fresh : undefined) ??
    (root.error ? pane.savedPane : undefined);
  // Herdr gives a moved terminal a new pane address. Keep its stable identity for this
  // route entry so a workspace move follows the chat instead of treating it as closed.
  const address = paneScopeKey(scope, paneId);
  const identity = useRef<{ address: string; terminalId?: string }>({ address });
  if (identity.current.address !== address) identity.current = { address };
  if (!identity.current.terminalId && addressed?.terminalId) identity.current.terminalId = addressed.terminalId;
  const terminalId = identity.current.terminalId;
  const agent = !terminalId || addressed?.terminalId === terminalId ? addressed : undefined;
  const moved = !agent && terminalId ? [...root.agents, ...root.shellPanes].find(candidate =>
    candidate.terminalId === terminalId && !candidate.trash && candidate.paneId !== paneId &&
    findPane([candidate], candidate.paneId, scope, root.servers, root.sessions) !== undefined,
  ) : undefined;
  const gone = !agent;

  // This pane is now its tab's pane on this device: the tab strip opens a tab on the pane it was last
  // open on (lib/tab-pane-memory.ts). Written when the pane is SHOWN, so a pane opened by a push, a
  // link or a switcher row is remembered the same way as one opened from the strip.
  const shownTabId = agent?.tabId;
  const shownHost = agent?.host;
  const shownSession = agent?.session;
  useEffect(() => {
    if (shownTabId === undefined) return;
    rememberTabPane({ paneId, tabId: shownTabId, host: shownHost, session: shownSession });
  }, [paneId, shownTabId, shownHost, shownSession]);
  // …and it leads this device's recent panes, the Actions palette's Recent rows (lib/recent-panes.ts).
  // Only a pane the live herd lists: a fresh or saved stand-in may carry a name that is not its own yet.
  const recentAgent = inSnapshot ? agent : undefined;
  const recentKey = recentAgent === undefined ? null : `${paneRowKey(recentAgent)}\u0000${panePlaceParts(recentAgent).space}`;
  const recentRef = useRef(recentAgent);
  recentRef.current = recentAgent;
  useEffect(() => {
    if (recentKey === null || recentRef.current === undefined) return;
    rememberRecentPane(recentRef.current);
  }, [recentKey]);

  // Recover from a closed pane: once a healthy snapshot no longer has it, go up a level instead of
  // leaving you on a dead "agent gone" view. Guarded on a connected, non-stale snapshot so a
  // transient poll failure or reconnect doesn't evict a still-valid pane. Up, not a replace onto
  // Home: the dead pane must not stay in history for the next swipe to land on (ADR 0067). Once per
  // pane, because an up can be a step back, and a second one would climb a level too far.
  //
  // From the zoomed output the first up only closes it, back onto this pane, and is not counted: the
  // effect runs again on the pane itself and climbs from there.
  //
  // The output, zoomed (`/pane/:id/zoom`, a child of this route): opening it is a step down, its ✕ an
  // up, so the ✕ steps back onto this pane and the phone's back does the same (ADR 0067).
  const zoomed = useMatch("/pane/:paneId/zoom") !== null;
  const exited = useRef<string | null>(null);
  useEffect(() => {
    if (active && gone && root.bridge === "connected" && !root.error && !root.stale && exited.current !== paneId) {
      if (moved) {
        const draft = loadDraftEntry(scope, paneId);
        if (draft) {
          saveDraft(scope, moved.paneId, draft.text, draft.attachments, draft.next);
          clearDraft(scope, paneId);
        }
        nav.side(zoomed ? zoomPath(moved.paneId, scope) : panePath(moved.paneId, scope), { freshPane: moved });
        return;
      }
      if (zoomed) {
        nav.up(panePath(paneId, scope));
        return;
      }
      exited.current = paneId;
      // The operator did not close this pane from this phone. It went away under them — from
      // another device, from the terminal itself, or because the agent exited — and a poll is what
      // noticed. The status (and the orbit round it turns) is what stops the eviction that follows
      // being the first thing they see.
      setStatus(t("notice.paneClosed"), "info");
      nav.up(homePath(scope));
    }
  }, [active, gone, moved, root.bridge, root.error, root.stale, nav, scope, paneId, zoomed]);

  // Up one level: to the space or the dashboard the pane was opened from (ADR 0067). A pane with no screen
  // is a durable program's conversation, and its way up is the machine's home, which is the conversation
  // list there (M53 spec 12): a NAMED parent, so a pane reached from a space page or a link lands on the list.
  const gridless = !useMuxCapability("paneGrid", scope).capable;
  const dismissSubagent = useRef<(() => boolean) | null>(null);
  const up = () => {
    if (dismissSubagent.current?.() === true) return;
    if (gridless) nav.upTo(homePath(scope));
    else nav.up(homePath(scope));
  };
  // Paths the agent prints open in Files (ADR 0088): the chat, its tool cards and the mirror below
  // all ask this one opener, which knows the pane's Changes root, its cwd and its machine's home.
  const herd = useMemo(() => [...root.agents, ...root.shellPanes], [root.agents, root.shellPanes]);
  const fileLinks = usePaneFileLinks({ paneId, scope, pane: agent, panes: herd, workspaces: root.workspaces });

  const view = (
    <FileLinksProvider value={fileLinks}>
    <SubagentSheet paneId={paneId} scope={scope} dismissRef={dismissSubagent}>
      <AgentChat
        // Keyed by the pane's FULL address, not its id. The key exists to remount the composer on a
        // pane switch so a draft never follows you into another terminal — and `w1:p1` is a different
        // terminal in every session and on every machine. Keyed by the id alone, walking from
        // `w1:p1` on one session to `w1:p1` on another kept the same mounted composer, draft and all.
        // `paneScopeKey` is the same triple every per-pane cache is keyed by.
        key={paneScopeKey(scope, paneId)}
        paneId={paneId}
        scope={scope}
        agent={agent}
        agentLaunch={agentLaunch}
        onLaunchReady={launchReady}
        agents={root.agents}
        shellPanes={root.shellPanes}
        tabs={root.tabs}
        servers={root.servers}
        text={pane.text}
        logicalText={pane.logicalText}
        requestedLines={pane.requestedLines}
        truncated={pane.truncated}
        olderRead={pane.olderRead === true}
        olderNote={pane.olderNote}
        revision={pane.revision}
        device={root.device}
        bridge={root.bridge}
        error={root.error}
        stalled={stalled}
        // The saved copy (M46 spec 10): the pane view dates it, and nothing on it may act (spec 11).
        stale={pane.stale === true}
        lastSeenAt={pane.lastSeenAt}
        // The pane's read got no answer and the phone keeps no text for it.
        noSavedCopy={pane.error && pane.text === ""}
        onBack={up}
        zoom={{
          open: zoomed,
          onOpen: () => nav.down(zoomPath(paneId, scope)),
          onClose: () => nav.up(panePath(paneId, scope)),
        }}
        onBackArrow={up}
        inStrip={false}
        // Tabletop: the belt and the reply box stand in the bottom segment, under the fold.
        tabletop={fold === "tabletop"}
        mobileShell
        unreadSince={fresh && fresh.paneId === paneId && isUnseen(fresh) ? fresh.lastSeenAt ?? 0 : undefined}
        // Pane to pane is a sideways move: it replaces, and the pane's way up comes along.
        onSelect={(id) =>
          nav.side(
            panePath(
              id,
              paneScope(
                scope,
                findPane([...root.agents, ...root.shellPanes], id, scope, root.servers, root.sessions),
                root.servers,
                root.sessions,
              ),
            ),
          )
        }
      />
    </SubagentSheet>
    </FileLinksProvider>
  );

  // The pane's walky talky list, the cross-check behind the Chat card and the mirror's row style (lib/walky.ts).
  return (
    <WalkyLogProvider rows={pane.walky} reads={pane.walkyReads}>
      {/* THE FOLD FRAME, always mounted so a posture change (the keyboard coming up on a tabletop
          fold, a hinge that moves) changes an attribute and never remounts the pane view under the
          finger. Tabletop ends this box at the top segment's bottom edge (index.css). */}
      <div data-slot="fold-frame" data-fold={fold} className="flex min-h-0 flex-1 flex-col">
        {view}
      </div>
    </WalkyLogProvider>
  );
}
