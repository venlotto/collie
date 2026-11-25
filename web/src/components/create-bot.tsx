import { useEffect, useRef, useState, type ReactNode } from "react";
import { fetchLaunchers, renamePane } from "@/lib/api";
import { useMuxCapability } from "@/lib/mux-capability";
import { setStatus } from "@/lib/status";
import { X } from "lucide-react";
import { useSpaceActions } from "@/hooks/use-spaces";
import { describeThrownError } from "@/lib/api-error-message";
import { mintRequestId } from "@/lib/worktree-name";
import { type Scope } from "@/lib/scope";
import { type AgentView } from "@/lib/types";
import { BlobAvatar } from "./bot-identity";
import { colorNames, colors, saveBot, silhouetteCount } from "@/lib/bot-identity";

function localName() { setStatus("El nombre quedó guardado en este dispositivo.", "info"); }

export function CreateBot({ scope, beside, writable, accessNotice, close }: { scope: Scope; beside?: AgentView; writable: boolean; accessNotice: ReactNode; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [silhouette, setSilhouette] = useState(12);
  const [color, setColor] = useState(8);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
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
    if (!writable || !name.trim() || busy || leaving) return;
    setError("");
    setPreparing(true);
    let catalog;
    try {
      catalog = (await fetchLaunchers(scope)).harnesses ?? null;
    } catch (err) {
      setError(describeThrownError(err));
      setPreparing(false);
      return;
    }
    const installed = catalog?.filter((h) => h.found);
    const harness = installed?.find((h) => h.id === beside?.agent) ?? installed?.[0];
    const outcome = await start({
      what: harness ? { kind: "harness", id: harness.id } : { kind: "shell" },
      legacyShell: catalog === null,
      beside, requestId: request.current,
    }, scope);
    setPreparing(false);
    if (outcome.kind === "done" && outcome.paneId) {
      saveBot(scope, outcome.paneId, { name: name.trim(), silhouette, color });
      if (rename.capable) {
        void renamePane(outcome.paneId, name.trim(), scope).then(res => res.ok ? undefined : localName(), localName);
      }
      close();
    } else {
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
      {accessNotice}
      {error && <p role="alert">{error}</p>}
      <button className="bot-create" disabled={!writable || !name.trim() || busy || leaving}>{busy ? "Creando…" : "Crear"}</button>
    </form>
  </dialog>;
}
