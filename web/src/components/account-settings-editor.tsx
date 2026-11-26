import { useEffect, useState } from "react";
import { accountFetch, isAccountPreference } from "@/lib/koperca-account";
import { mounted } from "@/lib/base-path";
import { asJsonObject, asJsonString, parseJson, parseJsonObject } from "@/lib/json";

interface Owner { sub: string; username: string }

async function loadOwners(signal: AbortSignal): Promise<Owner[]> {
  const res = await accountFetch(mounted("/api/user-settings/owners"), { signal });
  const rows = res.ok ? parseJson(await res.text()) : null;
  if (!Array.isArray(rows)) throw new Error("Account list unavailable");
  return rows.flatMap(row => {
    const user = asJsonObject(row);
    const sub = asJsonString(user?.sub);
    const username = asJsonString(user?.username);
    return sub && username ? [{ sub, username }] : [];
  });
}

function SettingsForOwner({ sub }: { sub: string }) {
  const [original, setOriginal] = useState<Record<string, string> | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const url = mounted("/api/user-settings?owner=" + encodeURIComponent(sub));
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await accountFetch(url, { signal: controller.signal });
        const obj = res.ok ? parseJsonObject(await res.text()) : undefined;
        if (!obj) throw new Error("Settings unavailable");
        const entries: [string, string][] = [];
        for (const [key, data] of Object.entries(obj)) {
          const value = asJsonString(data);
          if (isAccountPreference(key) && value !== undefined) entries.push([key, value]);
        }
        if (controller.signal.aborted) return;
        setOriginal(Object.fromEntries(entries));
        setDraft(JSON.stringify(Object.fromEntries(entries), null, 2));
      } catch {
        if (!controller.signal.aborted) setStatus("No se pudieron cargar los ajustes.");
      }
    })();
    return () => controller.abort();
  }, [url]);

  async function save() {
    if (busy || !original) return;
    const obj = parseJsonObject(draft);
    if (!obj) { setStatus("Introduce un objeto JSON de ajustes."); return; }
    const set: Record<string, string> = {};
    const next: Record<string, string> = {};
    for (const [key, data] of Object.entries(obj)) {
      const value = asJsonString(data);
      if (!isAccountPreference(key) || value === undefined) {
        setStatus("Cada ajuste debe tener una clave de preferencia válida y un valor de texto.");
        return;
      }
      next[key] = value;
      if (value !== original[key]) set[key] = value;
    }
    const remove = Object.keys(original).filter(key => !Object.hasOwn(next, key));
    setBusy(true); setStatus("");
    try {
      const res = await accountFetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ set, remove }) });
      if (!res.ok) throw new Error("Save failed");
      setOriginal(next);
      setStatus("Ajustes guardados.");
    } catch {
      setStatus("No se pudieron guardar los ajustes.");
    } finally {
      setBusy(false);
    }
  }
  return <>
    {original && <>
      <textarea aria-label="Ajustes de la cuenta en JSON" className="w-full rounded-lg p-3 font-mono text-sm" rows={7}
        value={draft} disabled={busy} spellCheck={false} onChange={event => setDraft(event.target.value)} />
      <button type="button" disabled={busy} onClick={() => void save()}>Guardar ajustes</button>
    </>}
    {status && <p role="status">{status}</p>}
  </>;
}

export function AccountSettingsEditor({ self }: { self: string }) {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState("Cargando cuentas…");
  useEffect(() => {
    const controller = new AbortController();
    void loadOwners(controller.signal).then(rows => {
      if (controller.signal.aborted) return;
      const others = rows.filter(user => user.sub !== self);
      setOwners(others);
      setStatus(others.length ? "" : "Todavía no hay otras cuentas en Collie.");
      return;
    }).catch(() => { if (!controller.signal.aborted) setStatus("No se pudieron cargar las cuentas."); });
    return () => controller.abort();
  }, [self]);
  return <div className="bot-workspace-fields">
    {status && <p role="status">{status}</p>}
    {owners.length > 0 && <label>Cuenta
      <select value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">Seleccionar</option>
        {owners.map(owner => <option value={owner.sub} key={owner.sub}>{owner.username}</option>)}
      </select>
    </label>}
    {selected && <SettingsForOwner key={selected} sub={selected} />}
  </div>;
}
