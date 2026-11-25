import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, LayoutGrid, ListChecks, MessageCircle, Plus, Search, Send, Star, UsersRound } from "lucide-react";
import { fetchChat } from "@/lib/api";
import { loadChatTail } from "@/lib/chat-tail";
import { paneRowKey } from "@/lib/hosts";
import { activityAt } from "@/lib/pane-order";
import { isUnseen } from "@/lib/triage";
import type { Scope } from "@/lib/scope";
import type { AgentView, TranscriptEntry, WorkspaceView } from "@/lib/types";
import { BlobAvatar, botTime, identityOf } from "./bot-identity";

interface Props {
  panes: readonly AgentView[];
  workspaces: readonly WorkspaceView[];
  featured?: AgentView;
  active?: AgentView;
  scopeOf: (pane: AgentView) => Scope;
  onOpen: (pane: AgentView) => void;
  onPress: (pane: AgentView) => void;
  onNew?: () => void;
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

export function MobileAgentHub({ panes, workspaces, featured, active, scopeOf, onOpen, onPress, onNew, accessNotice }: Props) {
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState<Set<string>>(new Set());
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
  useEffect(measure, [panes, workspaces, featured, query, folded, accessNotice]);
  useEffect(() => {
    if (!scroll.current || !footer.current || !window.ResizeObserver) return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroll.current);
    observer.observe(footer.current);
    return () => observer.disconnect();
  }, []);
  const needle = query.trim().toLocaleLowerCase();
  const groups = new Map<string, { title: string; rows: AgentView[] }>();
  function sectionFor(host: string | undefined, session: string | undefined, id: string, label: string) {
    const key = JSON.stringify([host, session, id]);
    if (!groups.has(key)) groups.set(key, { title: label || id, rows: [] });
    return groups.get(key)!;
  }
  for (const w of workspaces) sectionFor(w.host, undefined, w.workspaceId, w.label);
  for (const p of panes) {
    const section = sectionFor(p.host, scopeOf(p).session, p.workspaceId, p.workspaceLabel);
    if (!needle || [identityOf(p, scopeOf(p)).name, section.title, p.agent, p.subtitle].join(" ").toLocaleLowerCase().includes(needle)) section.rows.push(p);
  }
  function toggle(key: string) {
    setFolded((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  const featuredBot = featured && identityOf(featured, scopeOf(featured));
  return <div className="bot-index" aria-label="Chats">
    <header className="bot-bar">
      <span className="bot-user" aria-label="Perfil de Janez">J</span>
      <button aria-label="Crear nuevo" className="bot-circle bot-plus" disabled={!onNew} onClick={onNew}><Plus /></button>
    </header>
    <div className="bot-scroll" ref={scroll} onScroll={measure}>
      {accessNotice}
      {featured && featuredBot && !needle && <button className="bot-featured" onClick={() => onOpen(featured)}>
        <span className="bot-featured-face"><BlobAvatar {...featuredBot} /><i><Star size={12} fill="currentColor" /></i></span>
        <span className="bot-featured-name">{featuredBot.name}</span>
      </button>}
      {Array.from(groups, ([key, group]) => (!needle || group.rows.length > 0) && <section key={key} data-workspace={key}>
        <button className="bot-group" aria-expanded={!folded.has(key) || !!needle} disabled={!!needle} onClick={() => toggle(key)}>{group.title}<ChevronDown size={14} /></button>
        {(!folded.has(key) || !!needle) && <ul>{group.rows.map(p => {
          const scope = scopeOf(p);
          const bot = identityOf(p, scope);
          const selected = !!active && paneRowKey(active) === paneRowKey(p);
          return <li key={paneRowKey(p)}><button className="bot-row" aria-current={selected || undefined}
            onPointerDown={() => onPress(p)} onClick={() => onOpen(p)}>
            <BlobAvatar {...bot} />
            <span className="bot-copy">
              <span className="bot-row-title"><strong>{bot.name}</strong><time>{botTime(p.lastActiveAt || activityAt(p))}</time></span>
              <span className="bot-row-preview"><Preview pane={p} scope={scope} active={selected} />{isUnseen(p) && <span className="bot-unread" aria-label="Sin leer" />}</span>
            </span>
          </button></li>;
        })}</ul>}
      </section>)}
      {!accessNotice && (!panes.length || (needle && !Array.from(groups.values()).some(g => g.rows.length))) && <p className="bot-empty">{needle ? "Sin resultados" : "Aún no hay chats"}</p>}
    </div>
    {above > 0 && <button className="bot-jump bot-jump-up" onClick={() => unreadOutside().above.at(-1)?.scrollIntoView({ block: "center" })}>{above} sin leer <ChevronDown size={14} /></button>}
    {below > 0 && <button className="bot-jump bot-jump-down" onClick={() => unreadOutside().below[0]?.scrollIntoView({ block: "center" })}>{below} sin leer <ChevronDown size={14} /></button>}
    <div className="bot-search-foot" ref={footer}>
      {groups.size > 0 && <><button aria-label="Ir a un workspace" className="bot-circle bot-spaces" popoverTarget={picker}><LayoutGrid size={19} /></button>
        <div className="bot-picker" id={picker} popover="auto">{Array.from(groups, ([key, section]) =>
          <button key={key} popoverTarget={picker} popoverTargetAction="hide" onClick={() => {
            setQuery("");
            setFolded(prev => { const next = new Set(prev); next.delete(key); return next; });
            requestAnimationFrame(() => Array.from(scroll.current?.querySelectorAll("section") ?? []).find(el => el.dataset.workspace === key)?.scrollIntoView({ block: "start" }));
          }}>{section.title}</button>)}</div></>}
      <label className="bot-search"><Search size={18} /><input type="search" aria-label="Buscar" placeholder="Buscar" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
  </div>;
}
