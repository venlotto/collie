import { useEffect, useRef, useState } from "react";
import { fetchLaunchers, renamePane } from "@/lib/api";
import { useMuxCapability } from "@/lib/mux-capability";
import { setStatus } from "@/lib/status";
import { X } from "lucide-react";
import { useSpaceActions } from "@/hooks/use-spaces";
import { describeThrownError } from "@/lib/api-error-message";
import { mintRequestId } from "@/lib/worktree-name";
import { type Scope } from "@/lib/scope";
import { readBotPrefs, cacheBotPrefs } from "@/lib/bot-create-prefs";
import { type AgentView, type LaunchersResponse } from "@/lib/types";
import { BlobAvatar } from "./bot-identity";
import { colorNames, colors, saveBot, silhouetteCount } from "@/lib/bot-identity";

function localName() { setStatus("El nombre quedó guardado en este dispositivo.", "info"); }

export function CreateBot({ scope, beside, writable, close }: { scope: Scope; beside?: AgentView; writable: boolean; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [silhouette, setSilhouette] = useState(12);
  const [color, setColor] = useState(8);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [catalog, setCatalog] = useState<LaunchersResponse>();
  const [prefs, setPrefs] = useState(() => readBotPrefs(scope.host));
  const [reload, setReload] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryOnly, setRetryOnly] = useState(false);
  const { host, session } = scope;
  useEffect(() => {
    let active = true;
    setCatalog(undefined);
    setLoadFailed(false);
    setError("");
    const cached = readBotPrefs(host);
    setPrefs(cached);
    if (writable) void fetchLaunchers({ host, session }).then(result => {
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
  }, [host, session, writable, reload]);
  const profiles = catalog?.botCreate?.agents;
  const profile = profiles?.find(agent => agent.id === prefs.agent);
  const request = useRef(mintRequestId());
  const { start, creatingSpace } = useSpaceActions();
  const rename = useMuxCapability("renamePane", scope);
  const [preparing, setPreparing] = useState(false);
  const busy = creatingSpace || preparing;
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

  async function create() {
    if (!writable || !catalog || (profiles && !profile) || !name.trim() || busy || leaving) return;
    setError("");
    setPreparing(true);
    const installed = catalog.harnesses?.filter(h => h.found);
    const harness = installed?.find(h => h.id === beside?.agent) ?? installed?.[0];
    const outcome = await start({
      what: profile ? { kind: "harness", id: profile.harness, botCreate: prefs }
        : harness ? { kind: "harness", id: harness.id } : { kind: "shell" },
      legacyShell: catalog.harnesses === undefined,
      beside, requestId: request.current,
    }, scope);
    setPreparing(false);
    if (outcome.kind === "done" && outcome.paneId) {
      if (profile) cacheBotPrefs(host, prefs);
      saveBot(scope, outcome.paneId, { name: name.trim(), silhouette, color });
      if (rename.capable) {
        void renamePane(outcome.paneId, name.trim(), scope).then(res => res.ok ? undefined : localName(), localName);
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
      <header><button type="button" className="bot-circle" onClick={dismiss} aria-label="Cerrar"><X /></button><h2 id="create-bot-title">Crear nuevo Bot</h2></header>
      <div className="bot-preview"><BlobAvatar silhouette={silhouette} color={color} large /></div>
      <input aria-label="Nombre del bot" placeholder="Ponle nombre a tu Bot" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      <fieldset className="bot-shapes" aria-label="Forma">{Array.from({ length: silhouetteCount }, (_, i) =>
        <button key={i} type="button" aria-label={`Forma ${i + 1}`} aria-pressed={silhouette === i} onClick={() => setSilhouette(i)}><BlobAvatar silhouette={i} color={color} /></button>)}</fieldset>
      <fieldset className="bot-colors" aria-label="Color">{colors.map((hex, i) =>
        <button key={hex} type="button" aria-label={colorNames[i]} aria-pressed={color === i} onClick={() => setColor(i)}><span style={{ background: hex }} /></button>)}</fieldset>
      {(!catalog || profiles) && <div className="bot-launch-fields">
        <fieldset disabled={!catalog || busy || retryOnly} aria-label="Agente">
          <legend>Agente</legend>
          {(profiles?.map(agent => agent.id) ?? [prefs.agent]).map(id =>
            <button type="button" key={id} aria-pressed={id === prefs.agent} onClick={() => {
              const target = profiles?.find(a => a.id === id);
              setPrefs({ agent: id, effort: target?.efforts.includes(prefs.effort) ? prefs.effort : "high" });
            }}>{id}</button>)}
        </fieldset>
        {(profile || !catalog) && <fieldset disabled={!catalog || busy || retryOnly} aria-label="Reasoning">
          <legend>Reasoning</legend>
          {(profile?.efforts ?? [prefs.effort]).map(effort =>
            <button type="button" key={effort} aria-pressed={effort === prefs.effort}
              onClick={() => setPrefs({ ...prefs, effort })}>{effort}</button>)}
        </fieldset>}
        {profiles?.length === 0 && <p role="status">No hay agentes disponibles.</p>}
      </div>}
      {loadFailed && <button type="button" onClick={() => setReload(n => n + 1)}>Reintentar</button>}
      {error && <p role="alert">{error}</p>}
      <button className="bot-create" disabled={!writable || !catalog || (!!profiles && !profile) || !name.trim() || busy || leaving}>{busy ? "Creando…" : "Crear"}</button>
    </form>
  </dialog>;
}
