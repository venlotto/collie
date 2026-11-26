import { useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useRevalidator } from "react-router";
import { useChatWindow } from "@/hooks/use-chat-window";
import { useNav } from "@/hooks/use-nav";
import { useBotChromeOverlap } from "@/hooks/use-bot-chrome-overlap";
import { stopAgentRun } from "@/lib/api";
import { homePath } from "@/lib/nav";
import { paneScopeKey, type Scope } from "@/lib/scope";
import type { AgentView } from "@/lib/types";
import { activityStatusOf } from "@/lib/activity-status";
import { BotActivityPill } from "./bot-activity-avatar";
import { identityOf } from "./bot-identity";
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

export function AgentRunChat({ run, agent, scope, active, writable }: {
  run: Run; agent: AgentView; scope: Scope; active: boolean; writable: boolean;
}) {
  const nav = useNav();
  const refresh = useRevalidator();
  const id = "agent-run:" + run.id;
  const feed = useChatWindow({ paneId: id, scope, enabled: active });
  const root = useRef<HTMLDivElement>(null);
  const setBottom = useBotChromeOverlap(root);
  const list = useRef<ChatMessageListHandle>(null);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState(false);
  const bot = identityOf(agent, scope);
  const desk = useDeskControls();
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
    <footer ref={setBottom} className="agent-run-status"><span>{runProgress(run)}</span>
      {run.status === "running" && writable && <button disabled={stopping} onClick={stop}>{stopping ? "Deteniendo…" : "Detener"}</button>}
      {error && <span role="alert">No se pudo detener el run.</span>}
    </footer>
  </div>;
}
