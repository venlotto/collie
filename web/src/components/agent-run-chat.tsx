import { useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useRevalidator } from "react-router";
import { useChatWindow } from "@/hooks/use-chat-window";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { useLocale } from "@/hooks/use-locale";
import { useNav } from "@/hooks/use-nav";
import { useBotChromeOverlap } from "@/hooks/use-bot-chrome-overlap";
import { stopAgentRun } from "@/lib/api";
import { t } from "@/lib/i18n";
import { homePath, newPath } from "@/lib/nav";
import { paneSurface, UNREAD_SURFACE } from "@/lib/send-slot";
import { paneScopeKey, type Scope } from "@/lib/scope";
import type { AgentView } from "@/lib/types";
import { activityStatusOf } from "@/lib/activity-status";
import { BotActivityPill } from "./bot-activity-avatar";
import { identityOf } from "./bot-identity";
import { Composer } from "./composer";
import { useDeskControls } from "./bot-desk-controls";
import { SessionStream } from "./session-stream";
import type { ChatMessageListHandle } from "./ui/chat/chat-message-list";

type Run = NonNullable<AgentView["agentRun"]>;

const runState = { running: "Corriendo", done: "Listo", failed: "Falló", timeout: "Tiempo agotado", orphaned: "Sin supervisor" };
export function runProgress(run: Run, label = runState[run.status]) {
  const seconds = Math.max(0, Math.floor(((run.end ?? Date.now()) - run.start) / 1000));
  const elapsed = seconds >= 3600 ? Math.floor(seconds / 3600) + " h " + Math.floor(seconds % 3600 / 60) + " min" :
    seconds >= 60 ? Math.floor(seconds / 60) + " min" : seconds + " s";
  return label + " · " + elapsed;
}

export function AgentRunChat({ run, agent, scope, active, writable, readOnly, stale }: {
  run: Run; agent: AgentView; scope: Scope; active: boolean; writable: boolean; readOnly: boolean; stale: boolean;
}) {
  useLocale();
  const nav = useNav();
  const refresh = useRevalidator();
  const id = "agent-run:" + run.id;
  const feed = useChatWindow({ paneId: id, scope, enabled: active });
  const root = useRef<HTMLDivElement>(null);
  const setBottom = useBotChromeOverlap(root);
  const list = useRef<ChatMessageListHandle>(null);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState(false);
  const { prefs } = useDisplayPrefs();
  const bot = identityOf(agent, scope);
  const desk = useDeskControls();
  // The journal belongs to the detached run; a reply belongs to its real pane. A virtual run has no
  // send target, and a finished run has no resume route: neither may fall through to a blind shell write.
  const physical = !agent.paneId.startsWith("agent-run:");
  const replyPane = physical ? agent.paneId : id;
  const canSend = run.status === "running" && physical;
  const composerSurface = canSend ? paneSurface(agent.surface, agent.sendProtocol === true, undefined) : { surface: UNREAD_SURFACE, unreachableNote: undefined };
  const openNewChat = () => nav.down(newPath({ machine: scope.host, pane: physical ? agent.paneId : undefined, session: scope.session }));
  async function stop() {
    setStopping(true);
    setError(false);
    try {
      await stopAgentRun(run.id, scope);
    } catch {
      setError(true);
      setStopping(false);
    } finally {
      void refresh.revalidate();
    }
  }
  return <div ref={root} className="bot-conversation bot-agent-run">
    <header className="bot-bar bot-chat-bar agent-run-bar">
      {desk ?? <button className="bot-circle bot-back" aria-label="Volver a los chats" onClick={() => nav.upTo(homePath(scope))}><ChevronLeft /></button>}
      <BotActivityPill bot={bot} status={activityStatusOf(agent)} />
    </header>
    <SessionStream bot={bot} feed={feed} working={run.status === "running"} agent={agent.agent}
      address={paneScopeKey(scope, id)} showToolCalls={false} showCompactions={false} fontSize={15} listRef={list} />
    <div ref={setBottom} className="agent-run-bottom">
      <footer className="agent-run-status"><div className="agent-run-progress"><span>{runProgress(run)}</span>
        {run.status !== "running" && <small>{t("agentRun.finished.hint")}</small>}</div>
        {run.status === "running" && writable && <button disabled={stopping} onClick={stop}>{stopping ? "Deteniendo…" : "Detener"}</button>}
        {error && <span role="alert">No se pudo detener el run.</span>}
      </footer>
      <Composer
        paneId={replyPane}
        instance={agent.instance}
        surface={composerSurface.surface}
        unreachableNote={composerSurface.unreachableNote}
        scope={scope}
        stale={stale}
        agent={agent.agent}
        canSteer={agent.canSteer}
        isShell={agent.kind === "shell"}
        cwd={agent.cwd || undefined}
        gone={false}
        readOnly={readOnly}
        text=""
        terminalDraft={null}
        rawTerminalDraft={null}
        prefs={prefs}
        display={{ open: false, onToggle: () => undefined }}
        onSent={() => void refresh.revalidate()}
        sendAction={canSend ? undefined : { label: t("agentRun.finished.newChat"), onSelect: openNewChat }}
        held={agent.held}
        layout="box"
        minimal
        botName={bot.name}
      />
    </div>
  </div>;
}
