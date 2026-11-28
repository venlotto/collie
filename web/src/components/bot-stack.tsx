import { t } from "@/lib/i18n";
import { useLocale } from "@/hooks/use-locale";
import { MessagesSquare } from "lucide-react";
import { Activity, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useMediaQuery } from "@/hooks/use-media-query";
import { arrive, capacityOf, DESK_GAP, EMPTY_DESK, isDesk, prune, solo, updateDesk, useDesk } from "@/lib/bot-desk";
import { hasResizeObserver } from "@/lib/env";
import { findPane, paneRowKey } from "@/lib/hosts";
import type { PaneData } from "@/lib/loaders";
import { useRootData } from "@/lib/route-data";
import { isReadOnly } from "@/lib/types";
import { PaneScreen } from "@/routes/detail";
import { HomeRoute } from "@/routes/home";
import { AgentRunChat } from "./agent-run-chat";
import { BotDesk } from "./bot-desk";
import { StatusArea } from "./status-area";

export function BotStack({ paneId, pane }: { paneId?: string; pane?: PaneData }) {
  useLocale();
  const location = useLocation();
  // CSS places the panels. Only the covered list leaves the tab order on a phone.
  const split = useMediaQuery("(min-width: 768px)");
  const current = paneId !== undefined && pane ? { paneId, pane, location } : null;
  const last = useRef<typeof current>(null);
  const panel = useRef<HTMLElement>(null);
  const open = current !== null;
  const [parked, setParked] = useState(!open);
  // The chat panel's size decides whether it is one chat or a desk of several (components/bot-desk.tsx).
  const [area, setArea] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node || !hasResizeObserver()) return;
    const measure = () => setArea(a => a.width === node.clientWidth && a.height === node.clientHeight ? a : { width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (paneId && pane) last.current = { paneId, pane, location };
  }, [paneId, pane, location]);

  // Keep the departing pane painted until it clears the list. Then pause its
  // subscriptions and shortcuts, retaining the DOM, reading position and draft.
  useLayoutEffect(() => {
    if (open) {
      setParked(false);
      return;
    }
    let cancelled = false;
    const slides = panel.current?.getAnimations?.() ?? [];
    void Promise.allSettled(slides.map(slide => slide.finished)).then(() => {
      return cancelled ? undefined : setParked(true);
    });
    return () => { cancelled = true; };
  }, [open]);

  const screen = current || last.current;
  const root = useRootData();
  const row = screen && (findPane(root.shellPanes, screen.paneId, screen.pane.scope, root.servers, root.sessions) ??
    (!screen.pane.scope.host && screen.paneId.startsWith("agent-run:") ?
      root.shellPanes.find(p => p.agentRun && "agent-run:" + p.agentRun.id === screen.paneId) : undefined));
  const readOnly = isReadOnly(root.device);
  const writable = !root.authError && !root.error && !root.stale && !readOnly;
  const chat = screen && (row?.agentRun ? <AgentRunChat key={row.agentRun.id} run={row.agentRun} agent={row} active={open}
    scope={screen.pane.scope} writable={writable} readOnly={readOnly} stale={!writable && !readOnly} /> : <PaneScreen {...screen} active={open} />);
  // The desk keeps its gutters and the tray's row out of the windows' room.
  const capacity = capacityOf(area.width - 2 * DESK_GAP, area.height - 2 * DESK_GAP - DESK_TRAY_ROOM);
  const roomy = split && isDesk(capacity);
  // The route's pane by its full address, agents included (`row` above looks among shells and runs).
  const focused = current && (row ?? findPane(root.agents, current.paneId, current.pane.scope, root.servers, root.sessions));
  const focusKey = open && current ? paneRowKey(focused ?? { host: current.pane.scope.host, session: current.pane.scope.session, paneId: current.paneId }) : null;

  // THE DESK'S MEMORY follows the route, on a wide layout only (the phone keeps none). Opening a chat
  // puts it on the desk beside the others when two fit side by side, or replaces them when not. Going
  // back to the list from a single chat closes it: Back is that chat's close.
  const stored = useDesk();
  const seenFocus = useRef<string | null>(null);
  useEffect(() => {
    // Not before the panel is measured: an unmeasured panel reads as too narrow and would collapse the desk.
    if (!split || area.width === 0 || focusKey === seenFocus.current) return;
    seenFocus.current = focusKey;
    if (focusKey !== null) updateDesk(d => roomy ? arrive(d, focusKey, Date.now()) : solo(focusKey, Date.now()));
    else updateDesk(d => d.wins.length <= 1 ? EMPTY_DESK : d);
  }, [split, roomy, focusKey, area.width]);
  // Forget windows whose bot is gone, only on a live answer: an offline herd says nothing.
  const live = root.bridge === "connected" && !root.error && !root.stale && !root.authError;
  const liveKeys = useMemo(() => new Set([...root.agents, ...root.shellPanes].filter(p => !p.trash).map(paneRowKey)), [root.agents, root.shellPanes]);
  useEffect(() => {
    // An empty herd is more likely a first answer than every bot gone; the unknown windows stay hidden anyway.
    if (!split || !live || liveKeys.size === 0) return;
    updateDesk(d => prune(d, focusKey === null ? liveKeys : new Set([...liveKeys, focusKey])));
  }, [split, live, liveKeys, focusKey]);
  // The desk shows once a second chat is on it; one chat is the single screen, unchanged.
  const windows = stored.wins.filter(w => w.key === focusKey || liveKeys.has(w.key)).length +
    (focusKey !== null && !stored.wins.some(w => w.key === focusKey) ? 1 : 0);
  const desk = roomy && windows >= 2;
  return <div className="bot-layout" data-detail={open}>
    <aside inert={open && !split} className="bot-sidebar" aria-label={t("bot.list.sidebar")}><HomeRoute /></aside>
    <main inert={!open && !split} className="bot-detail" ref={panel} data-desk={desk ? "" : undefined}>
      {desk ? <BotDesk focusKey={focusKey} screen={open ? chat : null} capacity={capacity} /> : <>
        <Activity mode={open || !parked ? "visible" : "hidden"}>{chat}</Activity>
        {!open && <div className="bot-detail-empty">
          <MessagesSquare size={36} strokeWidth={1.5} aria-hidden />
          <p>{t("bot.desk.select")}</p>
        </div>}
      </>}
    </main>
    <div className="bot-notice"><StatusArea /></div>
  </div>;
}

/** The tray's row under the desk, counted whether or not the tray is showing, so the number of rows
 *  on the desk never flips when a window is minimised. */
const DESK_TRAY_ROOM = 56;
