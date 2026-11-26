import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { currentAccount } from "@/lib/koperca-account";
import { AccountAvatar } from "./account-avatar";
import { chatOrderId } from "@/lib/chat-order";
import { WorkspaceMenu } from "./bot-workspace-menu";
import { dragScope, sectionKey, useBotOrganization } from "./bot-organization";
import { saveBot, forgetBot } from "@/lib/bot-identity";
import { BotRow, BotActionSheet } from "./bot-selection";
import { FolderInput, Trash2, Undo2, ChevronDown, LayoutGrid, ListChecks, MessageCircle, Plus, Search, Send, Star, UserRound, UsersRound } from "lucide-react";
import { graphemeSegmenter } from "@/lib/env";
import { actOnBot, restoreWorkspace, fetchChat, type BotAction } from "@/lib/api";
import { loadChatTail } from "@/lib/chat-tail";
import { paneRowKey } from "@/lib/hosts";
import { activityAt } from "@/lib/pane-order";
import { isUnseen } from "@/lib/triage";
import type { Scope } from "@/lib/scope";
import type { AgentView, TranscriptEntry, WorkspaceView } from "@/lib/types";
import { BlobAvatar, botTime, identityOf } from "./bot-identity";

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
  deviceName?: string;
  accessNotice?: ReactNode;
}

function Preview({ pane, scope, active }: { pane: AgentView; scope: Scope; active: boolean }) {
  const [preview, setPreview] = useState<{ text: string; outgoing: boolean } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const { host, session } = scope;
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
    if (sensitive) return () => abort.abort();
    void loadChatTail({ host, session }, pane.paneId, pane.instance).then(saved => saved && !livePreview ? show(saved.entries) : undefined);
    const node = ref.current;
    if (!pane.hasSession || !node || !window.IntersectionObserver) return () => abort.abort();
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void fetchChat(pane.paneId, { limit: 3, turns: 1 }, { host, session }, abort.signal, { seen: false }).then(answer => {
        if (answer.outcome !== "body" || !answer.body.available || answer.body.page !== "live") return;
        livePreview = true;
        return show(answer.body.upserts);
      }).catch(() => { /* The saved preview and snapshot remain readable offline. */ });
    });
    observer.observe(node);
    return () => { observer.disconnect(); abort.abort(); };
  }, [host, session, pane.paneId, pane.instance, pane.hasSession, pane.surface?.field, active, pane.lastActiveAt]);
  const text = preview?.text || pane.subtitle || pane.hint || pane.terminalTitle || pane.tabLabel || pane.agent;
  const Icon = !preview && pane.kind === "shell" && text === pane.agent ? null
    : /^(mensaje de |\[walky-talky )/iu.test(text) ? UsersRound
    : preview?.outgoing || /^(le )?escribió a /iu.test(text) ? Send : pane.asks?.length ? ListChecks : MessageCircle;
  return <span ref={ref} className="bot-line">{Icon && <Icon size={13} aria-hidden />}<span>{text}</span></span>;
}

const segmenter = graphemeSegmenter();

export function MobileAgentHub({ writable, listScope, onChanged, panes, workspaces, featured, active, scopeOf, onOpen, onPress, onNew, deviceName = "", accessNotice }: Props) {
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"chats" | "trash" | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<"move" | "restore" | "purge" | null>(null);
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
  function unreadOutside() {
    const list = scroll.current;
    if (!list) return { above: [], below: [] };
    const bounds = list.getBoundingClientRect();
    const bottom = footer.current?.getBoundingClientRect().top ?? bounds.bottom;
    const unread = Array.from(list.querySelectorAll<HTMLButtonElement>(".bot-row:has(.bot-unread)"));
    return {
      above: unread.filter(el => el.getBoundingClientRect().bottom <= bounds.top),
      below: unread.filter(el => el.getBoundingClientRect().top >= bottom),
    };
  }
  function measure() {
    const outside = unreadOutside();
    setAbove(outside.above.length);
    setBelow(outside.below.length);
  }
  useEffect(measure, [panes, workspaces, featured, query, folded, accessNotice, mode]);
  useEffect(() => {
    if (!scroll.current || !footer.current || !window.ResizeObserver) return;
    const observer = new ResizeObserver(measure);
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
  const trashedSpaces = [...removed.values()].filter(s => !needle || s.title.toLocaleLowerCase().includes(needle));
  async function recover(space: typeof trashedSpaces[number]) {
    if (lock.current || !writable) return;
    lock.current = true;
    setBusy(true); setError("");
    try {
      await restoreWorkspace(space.scope, space.id, space.at);
    } catch {
      setError("No se pudo restaurar el workspace. Revisa la Papelera y vuelve a intentar.");
    } finally {
      lock.current = false;
      setBusy(false);
      onChanged();
    }
  }
  function toggle(key: string) {
    setFolded((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  const groupRows = [...groups.values()].flatMap(group => group.rows);
  const selectable = (p: AgentView) => writable && !!p.terminalId && !scopeOf(p).host;
  const choices = (mode === "trash" ? trashRows : groupRows).filter(selectable);
  const rowId = (p: AgentView) => JSON.stringify([scopeOf(p).session, p.terminalId, p.trash?.trashedAt]);
  const chosen = choices.filter(p => selection.has(rowId(p)));
  const destinations = [...groups.values()].filter(g => chosen.length > 0 && chosen.every(p =>
    scopeOf(p).session === g.scope.session && !g.scope.host));
  function select(p: AgentView, add: boolean) {
    if (!selectable(p) || busy) return;
    const target = p.trash ? "trash" : "chats";
    const id = rowId(p);
    setError("");
    setSelection(prev => {
      const next = new Set(mode === target ? prev : []);
      if (next.has(id) && !add) next.delete(id); else next.add(id);
      return next;
    });
    setMode(target);
  }
  function done() { setMode(null); setSelection(new Set()); setError(""); }
  function openSheet(next: typeof sheet) {
    setSheetOptions(destinations.map(({ id, title }) => ({ id, title })));
    setSheet(next);
    setLeaving(false);
    setError("");
  }
  async function apply(action: BotAction, workspaceId?: string) {
    if (!writable || lock.current || leaving || !chosen.length) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      for (const p of chosen) {
        const scope = scopeOf(p);
        const portrait = identityOf(p, scope);
        await actOnBot(action, p, scope, workspaceId);
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
      setError("No se pudo completar la acción. Revisa la selección y vuelve a intentar.");
    } finally {
      lock.current = false;
      setBusy(false);
      onChanged();
    }
  }
  function row(p: AgentView) {
    const scope = scopeOf(p);
    const bot = identityOf(p, scope);
    const current = !!active && paneRowKey(active) === paneRowKey(p);
    const matching = mode === (p.trash ? "trash" : "chats");
    const days = p.trash && Math.max(0, Math.ceil(7 - (Date.now() - p.trash.trashedAt) / 86_400_000));
    return <li key={paneRowKey(p)} data-drag-pane={!p.trash && selectable(p) ? chatOrderId(p) : undefined}><BotRow current={current}
      checked={mode ? matching && selection.has(rowId(p)) : undefined}
      disabled={busy || (!!mode && (!selectable(p) || !matching))}
      onHold={selectable(p) ? () => select(p, true) : undefined}
      onPress={() => { if (!mode && !p.trash) onPress(p); }}
      onOpen={() => { if (mode || p.trash) select(p, false); else onOpen(p); }}>
      <BlobAvatar {...bot} />
      <span className="bot-copy">
        <span className="bot-row-title"><strong>{bot.name}</strong><time>{botTime(p.lastActiveAt || activityAt(p))}</time></span>
        {days !== undefined ? <span className="bot-line">Se elimina en {days} {days === 1 ? "día" : "días"}</span> :
          <span className="bot-row-preview"><Preview pane={p} scope={scope} active={current} />{isUnseen(p) && <span className="bot-unread" aria-label="Sin leer" />}</span>}
      </span>
    </BotRow></li>;
  }
  const featuredBot = featured && identityOf(featured, scopeOf(featured));
  const initial = (segmenter?.segment(deviceName).containing(0)?.segment ?? Array.from(deviceName)[0])?.toLocaleUpperCase();
  return <div className="bot-index" aria-label="Chats">
    <div className="bot-list-surface">
      {mode ? <header className="bot-bar bot-select-bar">
        <button disabled={busy} onClick={done}>Listo</button>
        <strong aria-live="polite">{chosen.length} {chosen.length === 1 ? "seleccionado" : "seleccionados"}</strong>
        <button disabled={busy} onClick={() => setSelection(new Set(choices.map(rowId)))}>Seleccionar todo</button>
      </header> : <header className="bot-bar">
        {currentAccount() ? <AccountAvatar username={deviceName} initial={initial} /> :
          <span role="img" className="bot-user" aria-label={deviceName || "Perfil"}>{initial || <UserRound size={19} aria-hidden />}</span>}
        <button aria-label="Crear nuevo" className="bot-circle bot-plus" disabled={!onNew} onClick={onNew}><Plus /></button>
      </header>}
      <div className="bot-scroll" ref={scroll} onScroll={measure}>
        {accessNotice}
        {organize.error && <p role="alert" className="bot-access">{organize.error}</p>}
        {error && !sheet && <p className="bot-access" role="alert">{error}</p>}
        {featured && featuredBot && !needle && <button disabled={!!mode} className="bot-featured" onClick={() => onOpen(featured)}>
          <span className="bot-featured-face"><BlobAvatar {...featuredBot} /><i><Star size={12} fill="currentColor" /></i></span>
          <span className="bot-featured-name">{featuredBot.name}</span>
        </button>}
        {Array.from(groups, ([key, group]) => (!needle || group.rows.length > 0) && <section key={key} data-workspace={key} data-drag-space={!group.scope.host || undefined} data-drag-scope={dragScope(group.scope)}>
          <button className="bot-group" aria-expanded={!folded.has(key) || !!needle} disabled={!!needle} onClick={() => toggle(key)}>{group.title}<ChevronDown size={14} /></button>
          {(!folded.has(key) || !!needle) && <ul>{group.rows.map(row)}</ul>}
        </section>)}
        {(trashRows.length > 0 || trashedSpaces.length > 0) && <section data-workspace="trash">
          <button className="bot-group" aria-expanded={!folded.has("trash")} onClick={() => toggle("trash")}>Papelera<ChevronDown size={14} /></button>
          {!folded.has("trash") && <ul>{trashedSpaces.map(space =>
            <li className="bot-trashed-workspace" key={sectionKey(space.scope, space.id)}>
              <FolderInput size={22} aria-hidden /><span><strong>{space.title}</strong>
                <small>{space.count} {space.count === 1 ? "chat" : "chats"} · Se elimina en {Math.max(0, Math.ceil(7 - (Date.now() - space.at) / 86_400_000))} días</small></span>
              <button disabled={!writable || busy || !!mode || !!space.scope.host} onClick={() => void recover(space)}>Restaurar workspace</button>
            </li>)}{trashRows.map(row)}</ul>}
        </section>}
        {!trashedSpaces.length && !trashRows.length && !accessNotice && (!panes.length || (needle && !Array.from(groups.values()).some(g => g.rows.length))) && <p className="bot-empty">{needle ? "Sin resultados" : "Aún no hay chats"}</p>}
      </div>
      {above > 0 && <button className="bot-jump bot-jump-up" onClick={() => unreadOutside().above.at(-1)?.scrollIntoView({ block: "center" })}>{above} sin leer <ChevronDown size={14} /></button>}
      {below > 0 && <button className="bot-jump bot-jump-down" onClick={() => unreadOutside().below[0]?.scrollIntoView({ block: "center" })}>{below} sin leer <ChevronDown size={14} /></button>}
    </div>
    {organize.menu && <WorkspaceMenu {...organize.menu} />}
    {organize.dragging && <div className="bot-drop-trash"><Trash2 size={19} />Papelera</div>}
    <div className="bot-search-foot" ref={footer}>
      {mode ? <div className="bot-search bot-actions" role="toolbar" aria-label="Acciones de selección">
        {mode === "chats" ? <>
          <button disabled={!chosen.length || !destinations.length || busy} onClick={() => openSheet("move")}><FolderInput size={18} />Mover</button>
          <button disabled={!chosen.length || busy} onClick={() => void apply("trash")}><Trash2 size={18} />Eliminar</button>
        </> : <>
          <button disabled={!chosen.length || busy} onClick={() => {
            if (chosen.every(p => p.workspaceId === p.trash?.originalWorkspaceId ||
              destinations.some(g => g.id === p.trash?.originalWorkspaceId))) void apply("restore");
            else openSheet("restore");
          }}><Undo2 size={18} />Restaurar</button>
          <button disabled={!chosen.length || busy} onClick={() => openSheet("purge")}><Trash2 size={18} />Eliminar</button>
        </>}
      </div> : <>{groups.size > 0 && <><button aria-label="Ir a un workspace" className="bot-circle bot-spaces" popoverTarget={picker}><LayoutGrid size={19} /></button>
        <div className="bot-picker" id={picker} popover="auto">{Array.from(groups, ([key, section]) =>
          <button key={key} popoverTarget={picker} popoverTargetAction="hide" onClick={() => {
            setQuery("");
            setFolded(prev => { const next = new Set(prev); next.delete(key); return next; });
            requestAnimationFrame(() => Array.from(scroll.current?.querySelectorAll("section") ?? []).find(el => el.dataset.workspace === key)?.scrollIntoView({ block: "start" }));
          }}>{section.title}</button>)}</div></>}
      <label className="bot-search"><Search size={18} /><input type="search" aria-label="Buscar" placeholder="Buscar" value={query} onChange={e => setQuery(e.target.value)} /></label></>}</div>
    {sheet && <BotActionSheet busy={busy} leaving={leaving} dismiss={() => setLeaving(true)} close={() => { setSheet(null); setLeaving(false); }}
      title={sheet === "purge" ? "Eliminar definitivamente" : sheet === "restore" ? "Restaurar en" : "Mover a"}>
      {sheet === "purge" ? <>
        <p>Se cerrarán los chats seleccionados. Esta acción es permanente.</p>
        <button className="bot-choice bot-danger" disabled={busy || leaving || !chosen.length} onClick={() => void apply("purge")}>Eliminar definitivamente</button>
        <button className="bot-choice" disabled={busy || leaving} onClick={() => setLeaving(true)}>Cancelar</button>
      </> : sheetOptions.map(g => <button key={g.id} className="bot-choice" disabled={busy || leaving}
        onClick={() => void apply(sheet, g.id)}>{g.title}</button>)}
      {error && <p role="alert">{error}</p>}
    </BotActionSheet>}
  </div>;
}
