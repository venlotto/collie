import { trashMinutesRemaining } from "@/lib/trash-retention";
import { t, tn } from "@/lib/i18n";
import { runProgress } from "./agent-run-chat";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useBotListSelection } from "@/hooks/use-bot-list-selection";
import { useLongPress } from "@/hooks/use-long-press";
import { useBotSections } from "@/lib/bot-sections";
import { useBotFeatured } from "@/lib/bot-featured";
import { chatOrderId } from "@/lib/chat-order";
import { WorkspaceMenu } from "./bot-workspace-menu";
import { dragScope, sectionKey, useBotOrganization } from "./bot-organization";
import { saveBot, forgetBot } from "@/lib/bot-identity";
import { BotRow, BotActionSheet } from "./bot-selection";
import { Check, FolderInput, Trash2, Undo2, ChevronDown, LayoutGrid, ListChecks, MessageCircle, MoreHorizontal, Plus, Search, Send, Star, UserRound, UsersRound } from "lucide-react";
import { graphemeSegmenter } from "@/lib/env";
import { actOnBot, restoreWorkspace, trashWorkspace, fetchChat, type BotAction } from "@/lib/api";
import { loadChatTail } from "@/lib/chat-tail";
import { paneRowKey } from "@/lib/hosts";
import { activityAt } from "@/lib/pane-order";
import { isUnseen } from "@/lib/triage";
import type { Scope } from "@/lib/scope";
import type { AgentView, TranscriptEntry, WorkspaceView } from "@/lib/types";
import { BlobAvatar, botTime, identityOf } from "./bot-identity";
import { useLocale } from "@/hooks/use-locale";
import { activityStatusOf, type ActivityStatus } from "@/lib/activity-status";
import { BotActivityAvatar, activityLabel } from "./bot-activity-avatar";

interface Props {
  writable: boolean;
  listScope: Scope;
  onChanged: () => void;
  panes: readonly AgentView[];
  workspaces: readonly WorkspaceView[];
  featured?: AgentView;
  active?: AgentView;
  scopeOf: (pane: AgentView) => Scope;
  onOpen: (pane: AgentView) => void;
  onPress: (pane: AgentView) => void;
  onNew?: () => void;
  /** Tap "+": a bot with no questions. Resolves to the error to show. */
  onQuickNew?: () => Promise<string | undefined>;
  quickBusy?: boolean;
  deviceName?: string;
  accessNotice?: ReactNode;
}

function Preview({ pane, scope, active, status, label }: { pane: AgentView; scope: Scope; active: boolean; status: ActivityStatus; label: string }) {
  const [preview, setPreview] = useState<{ text: string; outgoing: boolean } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const { host, session } = scope;
  const run = pane.agentRun;
  const journalId = run ? "agent-run:" + run.id : pane.paneId;
  const hasJournal = !!run || pane.hasSession;
  const showRunProgress = !!run && status !== "idle";
  useEffect(() => {
    const abort = new AbortController();
    const show = (entries: readonly TranscriptEntry[]) => {
      const entry = entries.findLast(e => !e.abandoned && (e.role === "user" || e.role === "assistant") && e.parts.some(p => p.kind === "text"));
      const part = entry?.parts.findLast(p => p.kind === "text");
      if (!abort.signal.aborted && part?.kind === "text") setPreview({ text: part.text.trim().slice(0, 180), outgoing: entry?.role === "user" });
    };
    setPreview(null);
    let livePreview = false;
    const sensitive = pane.surface?.field === "secret";
    if (sensitive || showRunProgress) return () => abort.abort();
    void loadChatTail({ host, session }, journalId, pane.instance).then(saved => saved && !livePreview ? show(saved.entries) : undefined);
    const node = ref.current;
    if (!hasJournal || !node || !window.IntersectionObserver) return () => abort.abort();
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void fetchChat(journalId, { limit: 3, turns: 1 }, { host, session }, abort.signal, { seen: false }).then(answer => {
        if (answer.outcome !== "body" || !answer.body.available || answer.body.page !== "live") return;
        livePreview = true;
        return show(answer.body.upserts);
      }).catch(() => { /* The saved preview and snapshot remain readable offline. */ });
    });
    observer.observe(node);
    return () => { observer.disconnect(); abort.abort(); };
  }, [host, session, journalId, pane.instance, hasJournal, showRunProgress, pane.surface?.field, active, pane.lastActiveAt]);
  if (status !== "idle") return <span ref={ref} className="bot-line" data-activity={status}><span>{run ? runProgress(run, label) : label}</span></span>;
  const text = preview?.text || pane.subtitle || pane.hint || pane.terminalTitle || pane.tabLabel || pane.agent;
  const Icon = !preview && pane.kind === "shell" && text === pane.agent ? null
    : /^(mensaje de |\[walky-talky )/iu.test(text) ? UsersRound
    : preview?.outgoing || /^(le )?escribió a /iu.test(text) ? Send : pane.asks?.length ? ListChecks : MessageCircle;
  return <span ref={ref} className="bot-line">{Icon && <Icon size={13} aria-hidden />}<span>{text}</span></span>;
}

const segmenter = graphemeSegmenter();

export function MobileAgentHub({ writable, listScope, onChanged, panes, workspaces, featured, active, scopeOf, onOpen, onPress, onNew, onQuickNew, quickBusy = false, deviceName = "", accessNotice }: Props) {
  useLocale();
  const surface = useRef<HTMLDivElement>(null);
  useBotListSelection(surface);
  const [query, setQuery] = useState("");
  const { folded, toggle, setClosed } = useBotSections();
  const { clearFeatured } = useBotFeatured();
  const [mode, setMode] = useState<"chats" | "trash" | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [workspaceSelection, setWorkspaceSelection] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<"move" | "restore" | "purge" | "trash" | null>(null);
  const [sheetOptions, setSheetOptions] = useState<{ id: string; title: string }[]>([]);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const picker = useId();
  const footer = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(0);
  const [above, setAbove] = useState(0);
  const unreadRows = useRef<{ row: HTMLButtonElement; top: number; bottom: number }[]>([]);
  const visibleBand = useRef({ top: 0, bottom: 0 });
  function unreadOutside() {
    const offset = scroll.current?.scrollTop ?? 0;
    return {
      above: unreadRows.current.filter(r => r.bottom <= visibleBand.current.top + offset),
      below: unreadRows.current.filter(r => r.top >= visibleBand.current.bottom + offset),
    };
  }
  function countUnread() {
    const outside = unreadOutside();
    setAbove(outside.above.length);
    setBelow(outside.below.length);
  }
  // Geometry changes with the list or chrome. Scrolling only changes the offset.
  function measureUnread() {
    const list = scroll.current;
    if (!list) return;
    const bounds = list.getBoundingClientRect();
    visibleBand.current = {
      top: (list.previousElementSibling?.getBoundingClientRect().bottom ?? bounds.top) - bounds.top,
      bottom: (footer.current?.getBoundingClientRect().top ?? bounds.bottom) - bounds.top,
    };
    // The footer (search bar, and the unread chip above it) floats over the list's end. Its measured
    // height lets the last row rest above both, and hides rows under the chip while it shows.
    list.style.setProperty("--bot-foot-clip", Math.max(0, bounds.height - visibleBand.current.bottom) + "px");
    const offset = list.scrollTop - bounds.top;
    unreadRows.current = Array.from(list.querySelectorAll<HTMLButtonElement>(".bot-row:has(.bot-unread)"), button => {
      const box = button.getBoundingClientRect();
      return { row: button, top: box.top + offset, bottom: box.bottom + offset };
    });
    countUnread();
  }
  useEffect(measureUnread, [panes, workspaces, featured, query, folded, accessNotice, mode]);
  useEffect(() => {
    if (!scroll.current || !footer.current || !window.ResizeObserver) return;
    const observer = new ResizeObserver(measureUnread);
    observer.observe(scroll.current);
    observer.observe(footer.current);
    return () => observer.disconnect();
  }, []);
  const needle = query.trim().toLocaleLowerCase();
  const groups = new Map<string, { title: string; id: string; scope: Scope; rows: AgentView[] }>();
  function sectionFor(host: string | undefined, session: string | undefined, id: string, label: string) {
    const key = JSON.stringify([host, session, id]);
    if (!groups.has(key)) groups.set(key, { title: label || id, id, scope: { host, session }, rows: [] });
    return groups.get(key)!;
  }
  for (const w of workspaces) sectionFor(w.host ?? listScope.host, listScope.session, w.workspaceId, w.label);
  const trashRows: AgentView[] = [];
  const removed = new Map<string, { title: string; id: string; scope: Scope; at: number; count: number }>();
  for (const p of panes) {
    if (p.trash?.workspaceLabel !== undefined) {
      const scope = scopeOf(p);
      const id = p.trash.originalWorkspaceId;
      const key = sectionKey(scope, id);
      const entry = removed.get(key) ?? { title: p.trash.workspaceLabel, id, scope, at: p.trash.trashedAt, count: 0 };
      entry.count++;
      removed.set(key, entry);
      continue;
    }
    if (p.trash) {
      if (!needle || identityOf(p, scopeOf(p)).name.toLocaleLowerCase().includes(needle)) trashRows.push(p);
      continue;
    }
    const section = sectionFor(scopeOf(p).host, scopeOf(p).session, p.workspaceId, p.workspaceLabel);
    if (!needle || [identityOf(p, scopeOf(p)).name, section.title, p.agent, p.subtitle].join(" ").toLocaleLowerCase().includes(needle)) section.rows.push(p);
  }
  for (const key of removed.keys()) {
    // A chat created later in Herdr stays visible and outside this deletion.
    if (!panes.some(p => !p.trash && sectionKey(scopeOf(p), p.workspaceId) === key)) groups.delete(key);
  }
  const organize = useBotOrganization(groups, scroll, writable && !needle && !mode && !busy, onChanged);
  // Chats follow activity within their workspace; workspace placement follows the mux.
  for (const group of groups.values()) group.rows.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
  const orderedGroups = [...groups];
  const trashedSpaces = [...removed.values()].filter(s => !needle || s.title.toLocaleLowerCase().includes(needle));
  async function recover(space: typeof trashedSpaces[number]) {
    if (lock.current || !writable) return;
    lock.current = true;
    setBusy(true); setError("");
    try {
      await restoreWorkspace(space.scope, space.id, space.at);
    } catch {
      setError(t("bot.error.restoreWorkspace"));
    } finally {
      lock.current = false;
      setBusy(false);
      onChanged();
    }
  }
  const groupRows = [...groups.values()].flatMap(group => group.rows);
  const selectable = (p: AgentView) => writable && (!!p.terminalId || !!p.agentRun) && !scopeOf(p).host;
  const choices = (mode === "trash" ? trashRows : groupRows).filter(selectable);
  const rowId = (p: AgentView) => JSON.stringify([scopeOf(p).session, p.agentRun ? "agent-run:" + (p.agentRun.rootId ?? p.agentRun.id) : p.terminalId, p.trash?.trashedAt]);
  const workspaceChoices = mode === "chats" ? [...groups.values()].filter(g =>
    writable && !g.scope.host && g.id !== "agent-runs" && (!needle || g.rows.length > 0)) : [];
  const chosenWorkspaces = workspaceChoices.filter(g => workspaceSelection.has(sectionKey(g.scope, g.id)));
  const covered = (p: AgentView) => mode === "chats" && chosenWorkspaces.some(g => sectionKey(g.scope, g.id) === sectionKey(scopeOf(p), p.workspaceId));
  const chosen = choices.filter(p => selection.has(rowId(p)) && !covered(p));
  const chosenCount = chosen.length + chosenWorkspaces.length;
  function selectWorkspace(key: string) {
    if (busy) return;
    setWorkspaceSelection(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  const destinations = [...groups.values()].filter(g => g.id !== "agent-runs" && chosen.length > 0 && chosen.every(p =>
    scopeOf(p).session === g.scope.session && !g.scope.host));
  function select(p: AgentView, add: boolean) {
    if (!selectable(p) || covered(p) || busy) return;
    const target = p.trash ? "trash" : "chats";
    const id = rowId(p);
    setError("");
    setSelection(prev => {
      const next = new Set(mode === target ? prev : []);
      if (next.has(id) && !add) next.delete(id); else next.add(id);
      return next;
    });
    if (mode !== target) setWorkspaceSelection(new Set());
    setMode(target);
  }
  function done() { setMode(null); setSelection(new Set()); setWorkspaceSelection(new Set()); setError(""); }
  function openSheet(next: typeof sheet) {
    setSheetOptions(destinations.map(({ id, title }) => ({ id, title })));
    setSheet(next);
    setLeaving(false);
    setError("");
  }
  async function apply(action: BotAction, workspaceId?: string, swiped?: AgentView) {
    if (swiped && (mode || swiped.trash || !selectable(swiped))) return;
    const targets = swiped ? [swiped] : chosen;
    const targetWorkspaces = swiped ? [] : chosenWorkspaces;
    if (!writable || lock.current || leaving || !(targets.length + targetWorkspaces.length) || (targetWorkspaces.length > 0 && action !== "trash")) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      for (const space of targetWorkspaces) {
        const result = await trashWorkspace(space.scope, space.id);
        if (!result.ok) throw new Error(result.error);
        const key = sectionKey(space.scope, space.id);
        const members = panes.filter(p => sectionKey(scopeOf(p), p.workspaceId) === key);
        for (const p of members) clearFeatured(p);
        setWorkspaceSelection(prev => { const next = new Set(prev); next.delete(key); return next; });
        setSelection(prev => { const next = new Set(prev); for (const p of members) next.delete(rowId(p)); return next; });
      }
      for (const p of targets) {
        const scope = scopeOf(p);
        const portrait = identityOf(p, scope);
        const result = await actOnBot(action, p, scope, workspaceId);
        if (!result.ok) throw new Error("Chat action failed");
        if (action === "move" || action === "trash" || action === "purge") clearFeatured(p);
        if (p.terminalId) {
          if (action === "purge") forgetBot(scope, p.terminalId);
          else saveBot(scope, p.terminalId, portrait);
          forgetBot(scope, p.paneId);
        }
        setSelection(prev => { const next = new Set(prev); next.delete(rowId(p)); return next; });
      }
      if (sheet) setLeaving(true);
      done();
    } catch {
      setError(t("bot.error.selection"));
    } finally {
      lock.current = false;
      setBusy(false);
      onChanged();
    }
  }
  function row(p: AgentView) {
    const scope = scopeOf(p);
    const bot = identityOf(p, scope);
    const status = p.trash ? "idle" : activityStatusOf(p);
    const current = !!active && paneRowKey(active) === paneRowKey(p);
    const matching = mode === (p.trash ? "trash" : "chats");
    const minutes = p.trash && trashMinutesRemaining(p.trash.trashedAt);
    return <li key={paneRowKey(p)} data-drag-pane={!p.trash && selectable(p) && p.terminalId ? chatOrderId(p) : undefined}><BotRow current={current}
      checked={mode ? matching && (covered(p) || selection.has(rowId(p))) : undefined}
      disabled={busy || (!!mode && (!selectable(p) || !matching || covered(p)))}
      onHold={selectable(p) ? () => select(p, true) : undefined}
      onSwipeRight={!mode && !p.trash && selectable(p) ? () => { void apply("trash", undefined, p); } : undefined}
      onPress={() => { if (!mode && !p.trash) onPress(p); }}
      onOpen={() => { if (mode || p.trash) select(p, false); else onOpen(p); }}>
      <BotActivityAvatar bot={bot} status={status} />
      <span className="bot-copy">
        <span className="bot-row-title"><strong>{bot.name}</strong><time>{botTime(p.lastActiveAt || activityAt(p))}</time></span>
        {minutes !== undefined ? <span className="bot-line">{minutes ? t("bot.trash.remaining", { minutes }) : t("bot.trash.pending")}</span> :
          <span className="bot-row-preview"><Preview pane={p} scope={scope} active={current} status={status} label={activityLabel(status)} />{isUnseen(p) && <span className="bot-unread" aria-label={t("bot.list.unread")} />}</span>}
      </span>
    </BotRow></li>;
  }
  const featuredBot = featured && identityOf(featured, scopeOf(featured));
  const initial = (segmenter?.segment(deviceName).containing(0)?.segment ?? Array.from(deviceName)[0])?.toLocaleUpperCase();
  return <div ref={surface} className="bot-index" aria-label={t("bot.list.title")}>
    <div className="bot-list-surface">
      {mode ? <header className="bot-bar bot-select-bar">
        <button disabled={busy} onClick={done}>{t("shortcuts.bar.done")}</button>
        <strong aria-live="polite">{tn("bot.list.selected", chosenCount)}</strong>
        <button disabled={busy} onClick={() => { setSelection(new Set(choices.map(rowId))); setWorkspaceSelection(new Set(workspaceChoices.map(g => sectionKey(g.scope, g.id)))); }}>{t("bot.list.selectAll")}</button>
      </header> : <header className="bot-bar">
        <span role="img" className="bot-user" aria-label={deviceName || t("accounts.new.label")}>{initial || <UserRound size={19} aria-hidden />}</span>
        <PlusButton onNew={onNew} onQuickNew={onQuickNew && (() => void onQuickNew().then(message => setError(message ?? "")))} busy={quickBusy} />
      </header>}
      <div className="bot-scroll" ref={scroll} onScroll={countUnread} data-jump-below={below > 0 || undefined}>
        {accessNotice}
        {organize.error && <p role="alert" className="bot-access">{organize.error}</p>}
        {error && !sheet && <p className="bot-access" role="alert">{error}</p>}
        {featured && featuredBot && !needle && <button disabled={busy || (!!mode && (mode !== "chats" || !selectable(featured) || covered(featured)))} className="bot-featured"
          role={mode ? "checkbox" : undefined} aria-checked={mode ? covered(featured) || selection.has(rowId(featured)) : undefined}
          onClick={() => { if (mode) select(featured, false); else onOpen(featured); }}>
          {mode && <span aria-hidden className="bot-check">{(covered(featured) || selection.has(rowId(featured))) && <Check size={14} strokeWidth={3} />}</span>}
          <span className="bot-featured-face"><BlobAvatar {...featuredBot} /><i><Star size={12} fill="currentColor" /></i></span>
          <span className="bot-featured-name">{featuredBot.name}</span>
        </button>}
        {orderedGroups.map(([key, group]) => (!needle || group.rows.length > 0) && <section key={key} data-workspace={key} data-drag-space={(!group.scope.host && group.id !== "agent-runs") || undefined} data-drag-scope={dragScope(group.scope)}>
          <div className="bot-group-header"><button className="bot-group" role={mode === "chats" ? "checkbox" : undefined}
            aria-checked={mode === "chats" ? workspaceSelection.has(key) : undefined}
            aria-expanded={mode ? undefined : !folded.has(key) || !!needle}
            disabled={busy || (mode ? mode !== "chats" || !workspaceChoices.includes(group) : !!needle)}
            onClick={() => { if (mode === "chats") selectWorkspace(key); else toggle(key); }}>
            {mode === "chats" && <span aria-hidden className="bot-check">{workspaceSelection.has(key) && <Check size={14} strokeWidth={3} />}</span>}
            {group.title}{!mode && <ChevronDown size={14} />}
          </button>
          {!mode && writable && !group.scope.host && group.id !== "agent-runs" && <button className="bot-group-menu"
            aria-label={t("bot.workspace.options", { name: group.title })} disabled={busy || !!needle} onClick={() => organize.openMenu(key)}><MoreHorizontal size={18} aria-hidden /></button>}
          </div>
          {(!folded.has(key) || !!needle) && <ul>{group.rows.map(row)}</ul>}
        </section>)}
        {(trashRows.length > 0 || trashedSpaces.length > 0) && <section data-workspace="trash">
          <button className="bot-group" aria-expanded={!folded.has("trash") || !!needle} disabled={!!needle} onClick={() => toggle("trash")}>{t("bot.list.trash")}<ChevronDown size={14} /></button>
          {(!folded.has("trash") || !!needle) && <ul>{trashedSpaces.map(space =>
            <li className="bot-trashed-workspace" key={sectionKey(space.scope, space.id)}>
              <FolderInput size={22} aria-hidden /><span><strong>{space.title}</strong>
                <small>{tn("bot.list.chatCount", space.count)} · {trashMinutesRemaining(space.at) ? t("bot.trash.remaining", { minutes: trashMinutesRemaining(space.at) }) : t("bot.trash.pending")}</small></span>
              <button disabled={!writable || busy || !!mode || !!space.scope.host} onClick={() => void recover(space)}>{t("bot.list.restoreWorkspace")}</button>
            </li>)}{trashRows.map(row)}</ul>}
        </section>}
        {!trashedSpaces.length && !trashRows.length && !accessNotice && (!panes.length || (needle && !Array.from(groups.values()).some(g => g.rows.length))) && <p className="bot-empty">{needle ? t("bot.list.noResults") : t("bot.list.empty")}</p>}
      </div>
      {above > 0 && <button className="bot-jump bot-jump-up" onClick={() => unreadOutside().above.at(-1)?.row.scrollIntoView({ block: "center" })}>{t("bot.list.unreadCount", { count: above })} <ChevronDown size={14} /></button>}
    </div>
    {organize.menu && <WorkspaceMenu {...organize.menu} />}
    {organize.dragging && <div className="bot-drop-trash"><Trash2 size={19} />{t("bot.list.trash")}</div>}
    <div className="bot-search-foot" ref={footer}>
      {below > 0 && <div className="bot-jump-slot"><button className="bot-jump bot-jump-down" onClick={() => unreadOutside().below[0]?.row.scrollIntoView({ block: "center" })}>{t("bot.list.unreadCount", { count: below })} <ChevronDown size={14} /></button></div>}
      {mode ? <div className="bot-search bot-actions" role="toolbar" aria-label={t("bot.list.selectionActions")}>
        {mode === "chats" ? <>
          <button disabled={!chosen.length || !!chosenWorkspaces.length || !destinations.length || busy} onClick={() => openSheet("move")}><FolderInput size={18} />{t("chat.card.move")}</button>
          <button disabled={!chosenCount || busy} onClick={() => { if (chosenWorkspaces.length) openSheet("trash"); else void apply("trash"); }}><Trash2 size={18} />{t("chat.card.delete")}</button>
        </> : <>
          <button disabled={!chosen.length || busy} onClick={() => {
            if (chosen.every(p => p.workspaceId === p.trash?.originalWorkspaceId || (p.agentRun && p.trash?.originalWorkspaceId === "agent-runs") ||
              destinations.some(g => g.id === p.trash?.originalWorkspaceId))) void apply("restore");
            else openSheet("restore");
          }}><Undo2 size={18} />{t("bot.list.restore")}</button>
          <button disabled={!chosen.length || busy} onClick={() => openSheet("purge")}><Trash2 size={18} />{t("chat.card.delete")}</button>
        </>}
      </div> : <>{groups.size > 0 && <><button aria-label={t("bot.workspace.jump")} className="bot-circle bot-spaces" popoverTarget={picker}><LayoutGrid size={19} /></button>
        <div className="bot-picker" id={picker} popover="auto">{orderedGroups.map(([key, section]) =>
          <button key={key} popoverTarget={picker} popoverTargetAction="hide" onClick={() => {
            setQuery("");
            setClosed(key, false);
            requestAnimationFrame(() => Array.from(scroll.current?.querySelectorAll("section") ?? []).find(el => el.dataset.workspace === key)?.scrollIntoView({ block: "start" }));
          }}>{section.title}</button>)}</div></>}
      <label className="bot-search"><Search size={18} /><input type="search" aria-label={t("chat.card.search")} placeholder={t("chat.card.search")} value={query} onChange={e => setQuery(e.target.value)} /></label></>}</div>
    {sheet && <BotActionSheet busy={busy} leaving={leaving} dismiss={() => setLeaving(true)} close={() => { setSheet(null); setLeaving(false); }}
      title={sheet === "trash" ? t("bot.selection.trashTitle") : sheet === "purge" ? t("bot.list.permanentTitle") : sheet === "restore" ? t("bot.list.restoreTo") : t("bot.list.moveTo")}>
      {sheet === "trash" ? <>
        <p>{t("bot.selection.trashBody")}</p>
        <button className="bot-choice bot-danger" disabled={busy || leaving || !chosenCount} onClick={() => void apply("trash")}>{t("bot.selection.trashConfirm")}</button>
        <button className="bot-choice" disabled={busy || leaving} onClick={() => setLeaving(true)}>{t("bot.selection.cancel")}</button>
      </> : sheet === "purge" ? <>
        <p>{t("bot.list.permanentBody")}</p>
        <button className="bot-choice bot-danger" disabled={busy || leaving || !chosen.length} onClick={() => void apply("purge")}>{t("bot.list.permanentTitle")}</button>
        <button className="bot-choice" disabled={busy || leaving} onClick={() => setLeaving(true)}>{t("bot.selection.cancel")}</button>
      </> : sheetOptions.map(g => <button key={g.id} className="bot-choice" disabled={busy || leaving}
        onClick={() => void apply(sheet, g.id)}>{g.title}</button>)}
      {error && <p role="alert">{error}</p>}
    </BotActionSheet>}
  </div>;
}

/** Tap or click: a quick bot. Hold or right-click: the full create sheet. */
function PlusButton({ onNew, onQuickNew, busy }: { onNew?: () => void; onQuickNew?: () => void; busy: boolean }) {
  useLocale();
  const hold = useLongPress(!busy ? onNew : undefined);
  return <button {...hold} aria-label={t("bot.list.new")} aria-busy={busy || undefined} className="bot-circle bot-plus" disabled={(!onQuickNew && !onNew) || busy}
    onClick={(e) => {
      if (busy || e.detail >= 2) return;
      (onQuickNew ?? onNew)?.();
    }}><Plus /></button>;
}
