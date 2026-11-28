import { useEffect, useRef, useState } from "react";
import { actOnBot, createWorkspace, fetchLaunchers, renamePane } from "@/lib/api";
import { useMuxCapability } from "@/lib/mux-capability";
import { setStatus } from "@/lib/status";
import { X } from "lucide-react";
import { useSpaceActions } from "@/hooks/use-spaces";
import { describeThrownError } from "@/lib/api-error-message";
import { mintRequestId } from "@/lib/worktree-name";
import { type Scope } from "@/lib/scope";
import { readBotPrefs, cacheBotPrefs } from "@/lib/bot-create-prefs";
import { BOT_CREATE_PROFILES } from "@/lib/bot-create-profiles";
import { type AgentView, type LaunchersResponse, type WorkspaceView } from "@/lib/types";
import { type SpaceTarget } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useLocale } from "@/hooks/use-locale";
import { BlobAvatar, identityOf } from "./bot-identity";
import { colorNames, colors, randomBotAppearance, saveBot, silhouetteCount } from "@/lib/bot-identity";
import { setBotDisplay } from "@/lib/bot-display";
import { randomBotName } from "@/lib/bot-default-names";

function localName() { setStatus("El nombre quedó guardado en este dispositivo.", "info"); }

/** The workspace a bot lands in when the person picks none. */
export const UNASSIGNED_SPACE = "Sin asignar";
const unassignedCopy = /^Sin asignar-\d+$/;

/** Where "none picked" goes: the existing Sin asignar workspace, else a new one by that name. */
export function unassignedTarget(spaces: readonly WorkspaceView[]): SpaceTarget {
  const found = spaces.find(w => w.label === UNASSIGNED_SPACE) ?? spaces.find(w => unassignedCopy.test(w.label));
  return found ? { id: found.workspaceId } : { label: UNASSIGNED_SPACE };
}

type SpaceMode = "none" | "existing" | "new";
const NO_SPACES: readonly WorkspaceView[] = [];

export function CreateBot({ scope, beside, spaces = NO_SPACES, writable, close, edit }: {
  scope: Scope; beside?: AgentView; spaces?: readonly WorkspaceView[]; writable: boolean; close: () => void; edit?: AgentView;
}) {
  useLocale();
  const editing = edit !== undefined;
  const original = edit && identityOf(edit, scope);
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(original?.name ?? "");
  const [fallbackName] = useState(() => randomBotName());
  const [appearance] = useState(() => original ?? randomBotAppearance());
  const [silhouette, setSilhouette] = useState(appearance.silhouette);
  const [color, setColor] = useState(appearance.color);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [catalog, setCatalog] = useState<LaunchersResponse>();
  const [prefs, setPrefs] = useState(() => readBotPrefs(scope.host));
  const [reload, setReload] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryOnly, setRetryOnly] = useState(false);
  const [spaceMode, setSpaceMode] = useState<SpaceMode>(edit ? "existing" : "none");
  const [spaceId, setSpaceId] = useState(edit?.workspaceId ?? "");
  const [spaceName, setSpaceName] = useState("");
  const pickedSpace = spaces.find(w => w.workspaceId === spaceId) ?? spaces[0];
  const target: SpaceTarget | undefined = spaceMode === "existing" ? (pickedSpace && { id: pickedSpace.workspaceId })
    : spaceMode === "new" ? (spaceName.trim() ? { label: spaceName.trim() } : undefined)
    : unassignedTarget(spaces);
  const { host, session } = scope;
  useEffect(() => {
    let active = true;
    setCatalog(undefined);
    setLoadFailed(false);
    setError("");
    const cached = readBotPrefs(host);
    setPrefs(cached);
    if (writable && !editing) void fetchLaunchers({ host, session }).then(result => {
      if (!active) return;
      const profiles = result.botCreate;
      if (profiles) {
        const last = profiles.last ?? cached;
        const agent = profiles.agents.find(a => a.id === last.agent) ?? profiles.agents[0];
        if (agent) {
          setPrefs({ agent: agent.id, effort: agent.efforts.includes(last.effort) ? last.effort : "high" });
          if (profiles.last) cacheBotPrefs(host, profiles.last);
        }
      }
      return setCatalog(result);
    }, err => {
      if (active) { setError(describeThrownError(err)); setLoadFailed(true); }
    });
    return () => { active = false; };
  }, [host, session, writable, reload, editing]);
  const serverProfiles = catalog?.botCreate?.agents;
  const profiles = serverProfiles?.length ? serverProfiles : BOT_CREATE_PROFILES;
  const shownProfile = profiles.find(agent => agent.id === prefs.agent);
  const profile = serverProfiles?.find(agent => agent.id === prefs.agent);
  const request = useRef(mintRequestId());
  const { start, creatingSpace } = useSpaceActions();
  const rename = useMuxCapability("renamePane", scope);
  const [preparing, setPreparing] = useState(false);
  const busy = creatingSpace || preparing;
  const canChoose = !!serverProfiles?.length && !busy && !retryOnly;
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => closeRef.current(), 260);
    return () => clearTimeout(timer);
  }, [leaving]);
  const dismiss = () => { if (!busy) setLeaving(true); };

  const ready = writable && (edit ? !!name.trim() : !!catalog && (catalog.botCreate === undefined || !!profile)) && !!target;

  async function create() {
    if (!ready || !target || busy || leaving) return;
    setError("");
    setPreparing(true);
    if (edit) {
      try {
        const label = name.trim();
        if (label !== original?.name && rename.capable) {
          const result = await renamePane(edit.paneId, label, scope);
          if (!result.ok) throw new Error(result.error);
        }
        saveBot(scope, edit.terminalId ?? edit.paneId, { name: label, silhouette, color });
        let destination = "id" in target ? target.id : undefined;
        if (!destination) {
          const result = await createWorkspace({ label: "label" in target ? target.label : undefined, requestId: request.current }, scope);
          if (!result.ok) throw new Error(result.error);
          destination = result.pane.workspaceId;
        }
        if (destination !== edit.workspaceId) {
          const result = await actOnBot("move", edit, scope, destination);
          if (!result.ok) throw new Error(t("settings.worktreeFolder.failed"));
        }
        setLeaving(true);
      } catch (err) {
        setError(describeThrownError(err));
      } finally {
        setPreparing(false);
      }
      return;
    }
    const installed = catalog?.harnesses?.filter(h => h.found);
    const harness = installed?.find(h => h.id === beside?.agent) ?? installed?.[0];
    const outcome = await start({
      what: profile ? { kind: "harness", id: profile.harness, botCreate: prefs }
        : harness ? { kind: "harness", id: harness.id } : { kind: "shell" },
      legacyShell: catalog?.harnesses === undefined,
      space: target, requestId: request.current,
    }, scope);
    setPreparing(false);
    if (outcome.kind === "done" && outcome.paneId) {
      if (profile) cacheBotPrefs(host, prefs);
      const typed = name.trim();
      saveBot(scope, outcome.paneId, { name: typed || fallbackName, silhouette, color });
      setBotDisplay(scope, outcome.paneId, "chat");
      if (rename.capable) {
        void renamePane(outcome.paneId, typed || fallbackName, scope, !typed).then(res => res.ok ? undefined : localName(), localName);
      }
      setLeaving(true);
    } else {
      setRetryOnly(outcome.kind === "unknown");
      setError(outcome.kind === "refused" ? outcome.message : "No se pudo confirmar la creación. Vuelve a intentar.");
    }
  }

  return <dialog ref={dialog} className="bot-dialog" aria-labelledby="create-bot-title" data-leaving={leaving}
    onCancel={(e) => { e.preventDefault(); dismiss(); }}>
    <button type="button" aria-label="Descartar" tabIndex={-1} className="bot-backdrop" onClick={dismiss} />
    <form className="bot-sheet" onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <header><button type="button" className="bot-circle" onClick={dismiss} aria-label="Cerrar"><X /></button><h2 id="create-bot-title">{edit ? t("bot.edit.title") : "Crear nuevo Bot"}</h2></header>
      <div className="bot-preview"><BlobAvatar silhouette={silhouette} color={color} large /></div>
      <input aria-label="Nombre del bot" placeholder={fallbackName} maxLength={80} disabled={busy || (!!edit && !rename.capable)} value={name} onChange={(e) => setName(e.target.value)} />
      <fieldset disabled={busy} className="bot-shapes" aria-label="Forma">{Array.from({ length: silhouetteCount }, (_, i) =>
        <button key={i} type="button" aria-label={`Forma ${i + 1}`} aria-pressed={silhouette === i} onClick={() => setSilhouette(i)}><BlobAvatar silhouette={i} color={color} /></button>)}</fieldset>
      <fieldset disabled={busy} className="bot-colors" aria-label="Color">{colors.map((hex, i) =>
        <button key={hex} type="button" aria-label={colorNames[i]} aria-pressed={color === i} onClick={() => setColor(i)}><span style={{ background: hex }} /></button>)}</fieldset>
      <div className="bot-launch-fields">
        {!edit && <><fieldset disabled={!canChoose} aria-label="Agente">
          <legend>Agente</legend>
          {profiles.map(agent => <button type="button" key={agent.id} aria-pressed={agent.id === prefs.agent} onClick={() => {
            setPrefs({ agent: agent.id, effort: agent.efforts.includes(prefs.effort) ? prefs.effort : "high" });
          }}>{agent.id}</button>)}
        </fieldset>
        <fieldset disabled={!canChoose} aria-label="Reasoning">
          <legend>Reasoning</legend>
          {(shownProfile?.efforts ?? [prefs.effort]).map(effort =>
            <button type="button" key={effort} aria-pressed={effort === prefs.effort}
              onClick={() => setPrefs({ ...prefs, effort })}>{effort}</button>)}
        </fieldset>
        </>}
        <fieldset disabled={!writable || busy || retryOnly || (!!edit && !edit.terminalId)} aria-label="Workspace">
          <legend>Workspace</legend>
          <button type="button" aria-pressed={spaceMode === "none"} onClick={() => setSpaceMode("none")}>{UNASSIGNED_SPACE}</button>
          <button type="button" aria-pressed={spaceMode === "existing"} disabled={!spaces.length} onClick={() => setSpaceMode("existing")}>Existente</button>
          <button type="button" aria-pressed={spaceMode === "new"} onClick={() => setSpaceMode("new")}>Nuevo</button>
        </fieldset>
        {spaceMode === "existing" && pickedSpace && <select className="bot-space-choice" aria-label="Workspace existente" disabled={busy || retryOnly}
          value={pickedSpace.workspaceId} onChange={e => setSpaceId(e.target.value)}>
          {spaces.map(w => <option key={w.workspaceId} value={w.workspaceId}>{w.label || w.workspaceId}</option>)}
        </select>}
        {spaceMode === "new" && <input className="bot-space-choice" aria-label="Nombre del workspace nuevo" placeholder="Nombre del workspace"
          maxLength={80} value={spaceName} disabled={busy || retryOnly} onChange={e => setSpaceName(e.target.value)} />}
        {catalog && !catalog.botCreate && <p role="status">Este equipo no ofrece elegir agente.</p>}
        {catalog?.botCreate?.agents.length === 0 && <p role="status">No hay agentes disponibles.</p>}
      </div>
      {loadFailed && <button type="button" onClick={() => setReload(n => n + 1)}>Reintentar</button>}
      {error && <p role="alert">{error}</p>}
      <button className="bot-create" disabled={!ready || busy || leaving}>{edit ? t("settings.worktreeFolder.save") : busy ? "Creando…" : "Crear"}</button>
    </form>
  </dialog>;
}
