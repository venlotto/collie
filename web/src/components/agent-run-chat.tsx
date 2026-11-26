import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useRevalidator } from "react-router";
import { useChatWindow } from "@/hooks/use-chat-window";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { useLocale } from "@/hooks/use-locale";
import { useNav } from "@/hooks/use-nav";
import { useBotChromeOverlap } from "@/hooks/use-bot-chrome-overlap";
import { implementAgentRun, resumeAgentRun, stopAgentRun } from "@/lib/api";
import { t } from "@/lib/i18n";
import { homePath, newPath, panePath } from "@/lib/nav";
import { paneSurface, UNREAD_SURFACE } from "@/lib/send-slot";
import { paneScopeKey, type Scope } from "@/lib/scope";
import type { AgentView } from "@/lib/types";
import { activityStatusOf } from "@/lib/activity-status";
import { mintRequestId } from "@/lib/worktree-name";
import { BotActivityPill } from "./bot-activity-avatar";
import { identityOf } from "./bot-identity";
import { Composer, type ComposerHandle } from "./composer";
import { useDeskControls } from "./bot-desk-controls";
import { SessionStream } from "./session-stream";
import { AgentRunImplementSheet } from "./agent-run-implement";
import { Button } from "./ui/button";
import type { ChatMessageListHandle } from "./ui/chat/chat-message-list";

type Run = NonNullable<AgentView["agentRun"]>;

const runState = { running: "Corriendo", done: "Listo", stopped: "Detenido", failed: "Falló", timeout: "Tiempo agotado", orphaned: "Sin supervisor" };
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
  // The journal belongs to the detached run. A virtual continuation keeps the root address, so the
  // chain remains one bot and one draft even when there is no physical pane to reclaim.
  const physical = !agent.paneId.startsWith("agent-run:");
  const id = physical ? "agent-run:" + run.id : agent.paneId;
  const feed = useChatWindow({ paneId: id, scope, enabled: active });
  const root = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const setBottom = useBotChromeOverlap(root);
  const list = useRef<ChatMessageListHandle>(null);
  const [stopping, setStopping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [continued, setContinued] = useState(false);
  const [resumeFailed, setResumeFailed] = useState(false);
  const [implementOpen, setImplementOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resumeRequest = useRef(mintRequestId());
  const implementRequest = useRef(mintRequestId());
  const { prefs } = useDisplayPrefs();
  const bot = identityOf(agent, scope);
  const desk = useDeskControls();
  const replyPane = physical ? agent.paneId : id;
  const canSend = run.status === "running" && physical;
  const canResume = run.canResume === true && !resumeFailed;
  const composerSurface = canSend ? paneSurface(agent.surface, agent.sendProtocol === true, undefined) : { surface: UNREAD_SURFACE, unreachableNote: undefined };
  const openNewChat = () => {
    nav.down(newPath({ machine: scope.host, pane: physical ? agent.paneId : undefined, session: scope.session }));
    return false;
  };
  useEffect(() => {
    if (run.status === "running") setContinued(false);
  }, [run.id, run.status]);
  async function stop() {
    setStopping(true);
    setError(null);
    try {
      await stopAgentRun(run.id, scope);
    } catch {
      setError("No se pudo detener el run.");
      setStopping(false);
    } finally {
      void refresh.revalidate();
    }
  }
  async function resume(text: string): Promise<boolean> {
    if (busy || continued) return false;
    setBusy(true);
    setError(null);
    try {
      await resumeAgentRun(run.id, text, resumeRequest.current, scope);
      resumeRequest.current = mintRequestId();
      setContinued(true);
      void refresh.revalidate();
      return true;
    } catch {
      setResumeFailed(true);
      setError(t("agentRun.finished.resumeFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function implement(selectedAgent: string, effort: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const text = composer.current?.composedLine() ?? "";
    try {
      const answer = await implementAgentRun(run.id, text, selectedAgent, effort, implementRequest.current, scope);
      implementRequest.current = mintRequestId();
      composer.current?.clearDraft();
      setImplementOpen(false);
      void refresh.revalidate();
      if (answer.paneId) nav.down(panePath(answer.paneId, scope));
    } catch {
      setImplementOpen(false);
      setError(t("agentRun.implement.failed"));
    } finally {
      setBusy(false);
    }
  }
  const fallback = resumeFailed ? t("agentRun.finished.resumeFailed") : t("agentRun.finished.unsupported");
  return <div ref={root} className="bot-conversation bot-agent-run">
    <header className="bot-bar bot-chat-bar agent-run-bar">
      {desk ?? <button className="bot-circle bot-back" aria-label="Volver a los chats" onClick={() => nav.upTo(homePath(scope))}><ChevronLeft /></button>}
      <BotActivityPill bot={bot} status={activityStatusOf(agent)} />
    </header>
    <SessionStream bot={bot} feed={feed} working={run.status === "running" || continued} agent={agent.agent}
      address={paneScopeKey(scope, id)} showToolCalls={false} showCompactions={false} fontSize={15} listRef={list} />
    <div ref={setBottom} className="agent-run-bottom">
      <footer className="agent-run-status"><div className="agent-run-progress">
        <span>{continued ? t("agentRun.finished.working") : runProgress(run)}</span>
        {run.status !== "running" && <small>{continued ? t("agentRun.finished.pending") : canResume ? t("agentRun.finished.hint") : fallback}</small>}
        {error && <span role="alert">{error}</span>}
      </div>
        {run.status === "running" && writable && <button disabled={stopping} onClick={stop}>{stopping ? "Deteniendo…" : "Detener"}</button>}
        {run.status !== "running" && run.plan === true && canResume && writable &&
          <Button className="agent-run-implement" disabled={busy || continued} onClick={() => setImplementOpen(true)}>{t("agentRun.implement.action")}</Button>}
      </footer>
      <Composer
        ref={composer}
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
        sendAction={canSend ? undefined : canResume ?
          { label: continued ? t("agentRun.finished.working") : busy ? t("agentRun.finished.launching") : t("agentRun.finished.resume"),
            onSelect: resume, requiresDraft: true, busy: busy || continued } :
          { label: t("agentRun.finished.newChat"), onSelect: openNewChat }}
        held={agent.held}
        layout="box"
        minimal
        botName={bot.name}
      />
    </div>
    {implementOpen && <AgentRunImplementSheet plan={run.name ?? agent.paneLabel ?? run.id} originalAgent={run.harness}
      busy={busy} onClose={() => { if (!busy) setImplementOpen(false); }} onConfirm={(selected, effort) => void implement(selected, effort)} />}
  </div>;
}
