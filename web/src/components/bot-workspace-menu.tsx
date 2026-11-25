import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { describeThrownError } from "@/lib/api-error-message";
import { renameSpace, trashWorkspace } from "@/lib/api";
import { BotActionSheet } from "./bot-selection";
import type { Scope } from "@/lib/scope";

export interface WorkspaceChoice {
  id: string;
  title: string;
  scope: Scope;
}

export function WorkspaceMenu({ space, spaces, move, close, refresh }: {
  space: WorkspaceChoice; spaces: WorkspaceChoice[];
  move: (before: string | null) => Promise<void>; close: () => void; refresh: () => void;
}) {
  const [view, setView] = useState<"actions" | "name" | "move" | "trash">("actions");
  const [name, setName] = useState(space.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const locked = useRef(false);
  const index = spaces.findIndex(s => s.id === space.id);

  async function apply(work: () => Promise<void>) {
    if (locked.current || leaving) return;
    locked.current = true;
    setBusy(true); setError("");
    try {
      await work();
      refresh();
      setLeaving(true);
    } catch (err) {
      setError(describeThrownError(err));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function moveTo(position: number) {
    if (position === index) return;
    const others = spaces.filter(s => s.id !== space.id);
    void apply(() => move(others[position]?.id ?? null));
  }
  const title = view === "trash" ? "¿Eliminar workspace?" : space.title;
  const dismiss = () => { if (!locked.current) setLeaving(true); };
  return <BotActionSheet title={title} leaving={leaving} busy={busy} close={close} dismiss={dismiss}>
      <fieldset className="bot-workspace-fields" disabled={busy || leaving}>
        {view === "actions" && <>
          <button onClick={() => setView("name")}><Pencil />Renombrar</button>
          <button disabled={spaces.length < 2} onClick={() => setView("move")}><ArrowUp />Mover</button>
          <button className="danger" onClick={() => setView("trash")}><Trash2 />Eliminar workspace</button>
        </>}
        {view === "name" && <form onSubmit={e => { e.preventDefault(); void apply(async () => {
          const res = await renameSpace(space.id, name.trim(), space.scope);
          if (!res.ok) throw new Error(res.error);
        }); }}>
          <input aria-label="Nombre del workspace" value={name} autoFocus maxLength={80} onChange={e => setName(e.target.value)} />
          <button disabled={!name.trim()}>Guardar</button>
        </form>}
        {view === "move" && <>
          <button disabled={index <= 0} onClick={() => moveTo(index - 1)}><ArrowUp />Subir</button>
          <button disabled={index >= spaces.length - 1} onClick={() => moveTo(index + 1)}><ArrowDown />Bajar</button>
          <label>Posición<select value={index} onChange={e => moveTo(Number(e.target.value))}>
            {spaces.map((s, i) => <option key={s.id} value={i}>{i + 1}</option>)}</select></label>
        </>}
        {view === "trash" && <>
          <p>«{space.title}» y sus chats se guardarán en la Papelera durante 7 días.</p>
          <button className="danger" onClick={() => void apply(async () => {
            const res = await trashWorkspace(space.scope, space.id);
            if (!res.ok) throw new Error(res.error);
          })}><Trash2 />Enviar a Papelera</button>
          <button onClick={dismiss}>Cancelar</button>
        </>}
      </fieldset>
      {error && <p role="alert">{error}</p>}
  </BotActionSheet>;
}
