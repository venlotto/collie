// THE DESK (local patch, Koperca Agent Hub): on a wide screen, several bot chats open side by side.
//
// The route's pane is the focused window and is the full chat screen it always was (composer, menus,
// shortcuts). Every other window on the desk is a live read of its chat (`DeskPeek`): the same stream,
// polled with the app, and one click away from becoming the focus. Minimised windows wait in the tray
// under the desk. Closing a window takes it off the desk only: the bot keeps running and stays in the
// list. Which windows are open is remembered per device (lib/bot-desk.ts).
//
// Phones, narrow windows and a desk with one chat never see any of this: the chat screen stays the
// single panel it was, Back arrow included (BotStack decides, and keeps the device's desk).

import { Maximize2, Minimize2, Minus, MessagesSquare, X } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { DeskControlsContext } from "./bot-desk-controls";
import "./bot-desk.css";
import { useBotChromeOverlap } from "@/hooks/use-bot-chrome-overlap";
import { useChatWindow } from "@/hooks/use-chat-window";
import { useNav } from "@/hooks/use-nav";
import { usePaneScreen } from "@/hooks/use-pane-screen";
import { activityStatusOf } from "@/lib/activity-status";
import { parseAnsi } from "@/lib/ansi";
import { t } from "@/lib/i18n";
import { splitLines } from "@/lib/blocks";
import { arrange, arrive, closeWindow, gridOf, minimise, nextFocus, toggleMax, updateDesk, useDesk, type Capacity } from "@/lib/bot-desk";
import { paneRowKey, paneScope } from "@/lib/hosts";
import { paneSessionLog, useMuxCapability } from "@/lib/mux-capability";
import { homePath, panePath } from "@/lib/nav";
import { useRootData } from "@/lib/route-data";
import { paneScopeKey, type Scope } from "@/lib/scope";
import { isUnseen } from "@/lib/triage";
import type { AgentView } from "@/lib/types";
import { BotActivityAvatar } from "./bot-activity-avatar";
import { BotChatBar } from "./bot-chat-bar";
import { botFeaturedMatches, useBotFeatured } from "@/lib/bot-featured";
import { isReadOnly } from "@/lib/types";
import { useRevalidator } from "react-router";
import { identityOf } from "./bot-identity";
import { RawMirror } from "./raw-mirror";
import { SessionStream } from "./session-stream";
import type { ChatMessageListHandle } from "./ui/chat/chat-message-list";

/** How long a window takes to leave, so its slot does not vanish under the pointer. */
const LEAVE_MS = 160;

/** A press on a control never also focuses the window under it. */
function own(act: () => void) {
  return (e: MouseEvent) => {
    e.stopPropagation();
    act();
  };
}

function WindowControls({ name, maxed, onMin, onMax, onClose }: {
  name: string; maxed: boolean; onMin: () => void; onMax: () => void; onClose: () => void;
}) {
  return <div className="bot-desk-ctrls" role="group" aria-label={"Ventana de " + name}>
    <button type="button" className="bot-desk-ctrl" aria-label="Minimizar" title="Minimizar" onClick={own(onMin)}><Minus size={16} /></button>
    <button type="button" className="bot-desk-ctrl" aria-label={maxed ? "Restaurar" : "Maximizar"} title={maxed ? "Restaurar" : "Maximizar"}
      aria-pressed={maxed} onClick={own(onMax)}>{maxed ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
    <button type="button" className="bot-desk-ctrl bot-desk-close" aria-label="Cerrar ventana" title="Cerrar ventana" onClick={own(onClose)}><X size={16} /></button>
  </div>;
}

/** What a window's controls do, read at press time so the controls themselves stay the same object. */
interface WindowActs {
  minimise: (key: string) => void;
  close: (key: string) => void;
  maximise: (key: string) => void;
  focus: (key: string) => void;
}

/** A press that moved less than this is a tap, not a scroll or a text selection. */
const TAP_SLOP_PX = 8;

function DeskWindow({ windowKey, name, maxed, focused, leaving, acts, children }: {
  windowKey: string; name: string; maxed: boolean; focused: boolean; leaving: boolean;
  acts: RefObject<WindowActs>; children: ReactNode;
}) {
  const controls = useMemo(() => <WindowControls name={name} maxed={maxed}
    onMin={() => acts.current.minimise(windowKey)} onClose={() => acts.current.close(windowKey)}
    onMax={() => acts.current.maximise(windowKey)} />, [name, maxed, windowKey, acts]);
  const press = useRef<{ x: number; y: number } | null>(null);
  // A tap anywhere on a window without the focus hands it the focus. A tap, not a press: a drag is a
  // scroll or a selection. Its own buttons (the controls, a step to unfold) keep their own act.
  return <section className="bot-window" aria-label={name} data-focused={focused ? "" : undefined} data-leaving={leaving ? "" : undefined}
    onPointerDown={e => { press.current = { x: e.clientX, y: e.clientY }; }}
    onPointerUp={e => {
      const p = press.current;
      press.current = null;
      if (focused || p === null || Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP_PX) return;
      if (e.target instanceof Element && e.target.closest("button, a, input, textarea") !== null) return;
      if (window.getSelection()?.toString()) return;
      acts.current.focus(windowKey);
    }}>
    <DeskControlsContext.Provider value={controls}>{children}</DeskControlsContext.Provider>
  </section>;
}

/** A window without the focus: its chat, live, read only. Any click on it hands it the focus. */
function DeskPeek({ pane, scope, onReply }: { pane: AgentView; scope: Scope; onReply: () => void }) {
  const data = useRootData();
  const refresh = useRevalidator();
  const { featured, setFeatured } = useBotFeatured();
  const run = pane.agentRun;
  const id = run ? "agent-run:" + run.id : pane.paneId;
  const sessionLog = paneSessionLog(useMuxCapability("agentSessionRef", scope), pane.hasSession);
  const chat = !!run || (pane.kind !== "shell" && sessionLog.capable && pane.hasSession === true);
  const feed = useChatWindow({ paneId: id, scope, instance: pane.instance, enabled: chat, seen: false });
  const screenText = usePaneScreen(pane.paneId, scope, !chat);
  const lines = useMemo(() => (screenText === null ? [] : splitLines(parseAnsi(screenText))), [screenText]);
  const root = useRef<HTMLDivElement>(null);
  const setBottom = useBotChromeOverlap(root);
  const list = useRef<ChatMessageListHandle>(null);
  const bot = identityOf(pane, scope);
  // The reply row floats over the stream, so the stream's own "latest" button stands above it.
  const [clear, setClear] = useState(0);
  const footer = useCallback((node: HTMLElement | null) => {
    setBottom(node);
    if (node) setClear(Math.ceil(node.getBoundingClientRect().height));
  }, [setBottom]);
  return <div ref={root} className="bot-conversation bot-agent-run bot-desk-peek">
    <BotChatBar className="agent-run-bar" bot={bot} pane={pane} unread={0} terminal={!chat} back={onReply}
      pinned={!!featured && botFeaturedMatches(featured, pane)} pin={() => setFeatured(pane, !featured || !botFeaturedMatches(featured, pane))}
      actions={{ scope, writable: !data.authError && !data.error && !data.stale && !isReadOnly(data.device),
        onChanged: () => { void refresh.revalidate(); } }} />
    {chat ? <SessionStream bot={bot} feed={feed} working={run ? run.status === "running" : pane.status === "working"} agent={pane.agent}
      address={paneScopeKey(scope, id)} showToolCalls={false} showCompactions={false} fontSize={15} listRef={list} clearBottom={clear} />
      : <div><div data-slot="session-stream" className="bot-desk-mirror">
        {lines.length > 0 && <div className="bot-terminal"><RawMirror lines={lines} wrap /></div>}
      </div></div>}
    <footer ref={footer} className="agent-run-status bot-desk-reply-row">
      {/* A window without the focus draws no dialog card (the focused chat owns the screen's cards), so
          a question it waits on would stay invisible on the desk. One line says so and hands it the focus,
          where the card is. Only while the bridge says it needs you (blocked-settle.ts keeps that honest). */}
      {activityStatusOf(pane) === "blocked" && (
        <button type="button" className="bot-desk-waiting" onClick={e => { e.stopPropagation(); onReply(); }}>
          {t("bot.desk.questionWaiting")}
        </button>
      )}
      <button type="button" className="bot-desk-reply" onClick={e => { e.stopPropagation(); onReply(); }}>
        {pane.kind === "shell" && !run ? "Escribir un comando…" : `Preguntar a ${bot.name}…`}
      </button>
    </footer>
  </div>;
}

export function BotDesk({ focusKey, screen, capacity }: {
  /** `paneRowKey` of the route's pane, or null on the list alone. */
  focusKey: string | null;
  /** The route's full chat screen, drawn inside the focused window. */
  screen: ReactNode;
  capacity: Capacity;
}) {
  const data = useRootData();
  const nav = useNav();
  const desk = useDesk();
  const [leaving, setLeaving] = useState<string | null>(null);
  const replyTo = useRef<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  const panes = useMemo(() => [...data.agents, ...data.shellPanes].filter(p => !p.trash), [data.agents, data.shellPanes]);
  const byKey = useMemo(() => new Map(panes.map(p => [paneRowKey(p), p] as const)), [panes]);
  const scopeOf = (pane: AgentView) => paneScope(data.scope, pane, data.servers, data.sessions);

  // Until BotStack's arrive effect lands, the focus is drawn as if it had.
  const view = focusKey !== null && !desk.wins.some(w => w.key === focusKey) ? arrive(desk, focusKey, Number.MAX_SAFE_INTEGER) : desk;
  const known = { ...view, wins: view.wins.filter(w => w.key === focusKey || byKey.has(w.key)) };
  const { shown, tray } = arrange(known, focusKey, capacity);
  const cells = gridOf(shown.length, capacity);

  // "Preguntar a …" on a window without the focus: once it has the focus, its reply box does too.
  useLayoutEffect(() => {
    if (focusKey === null || replyTo.current !== focusKey) return;
    replyTo.current = null;
    let tries = 0;
    let frame = 0;
    const seek = () => {
      const box = grid.current?.querySelector<HTMLTextAreaElement>('.bot-window[data-focused] textarea');
      if (box) return box.focus();
      if (++tries < 40) frame = requestAnimationFrame(seek);
    };
    frame = requestAnimationFrame(seek);
    return () => cancelAnimationFrame(frame);
  }, [focusKey]);

  const focus = (key: string, reply = false) => {
    const pane = byKey.get(key);
    if (pane === undefined || key === focusKey) return;
    if (reply) replyTo.current = key;
    nav.open(panePath(pane.paneId, scopeOf(pane)), { freshPane: pane });
  };
  // A window leaving the focus hands it to the most recent window still on the desk, else the list.
  const leave = (key: string, step: typeof minimise) => {
    setLeaving(key);
    window.setTimeout(() => {
      setLeaving(null);
      const after = updateDesk(d => step(d, key));
      if (key !== focusKey) return;
      const next = nextFocus(after, key);
      const pane = next === null ? undefined : byKey.get(next);
      if (pane !== undefined) nav.side(panePath(pane.paneId, scopeOf(pane)), { freshPane: pane });
      else nav.upTo(homePath(data.scope));
    }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : LEAVE_MS);
  };

  const acts = useRef<WindowActs>({ minimise: () => undefined, close: () => undefined, maximise: () => undefined, focus: () => undefined });
  acts.current = {
    minimise: key => leave(key, minimise),
    close: key => leave(key, closeWindow),
    // A window filling the desk is the one you work in, so it takes the focus too.
    maximise: key => {
      updateDesk(d => toggleMax(d, key));
      focus(key);
    },
    focus: key => focus(key),
  };

  return <div className="bot-desk" data-windows={shown.length}>
    {shown.length === 0 ? <div className="bot-detail-empty">
      <MessagesSquare size={36} strokeWidth={1.5} aria-hidden />
      <p>Selecciona un chat</p>
    </div> : <div ref={grid} className="bot-desk-grid"
      style={{ gridTemplateColumns: `repeat(${cells.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${cells.rows}, minmax(0, 1fr))` }}>
      {shown.map(key => {
        const pane = byKey.get(key);
        const focused = key === focusKey;
        return <DeskWindow key={key} windowKey={key} name={pane ? identityOf(pane, scopeOf(pane)).name : "Chat"} acts={acts}
          maxed={desk.max === key} focused={focused} leaving={leaving === key}>
          {focused ? screen : pane && <DeskPeek pane={pane} scope={scopeOf(pane)} onReply={() => focus(key, true)} />}
        </DeskWindow>;
      })}
    </div>}
    {tray.length > 0 && <nav className="bot-desk-tray" aria-label="Chats minimizados">
      {tray.flatMap(key => {
        const pane = byKey.get(key);
        if (pane === undefined) return [];
        const bot = identityOf(pane, scopeOf(pane));
        return [<button key={key} type="button" className="bot-pill bot-desk-chip" onClick={() => focus(key)} title={bot.name}>
          <BotActivityAvatar bot={bot} status={activityStatusOf(pane)} /><strong>{bot.name}</strong>
          {isUnseen(pane) && <span className="bot-unread" aria-label="Sin leer" />}
        </button>];
      })}
    </nav>}
  </div>;
}
