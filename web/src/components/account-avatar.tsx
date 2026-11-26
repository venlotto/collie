import { useState } from "react";
import { Link } from "react-router";
import { AccountSettingsEditor } from "./account-settings-editor";
import { currentAccount, signOutAccount } from "@/lib/koperca-account";
import { BotActionSheet } from "./bot-selection";

export function AccountAvatar({ username, initial }: { username: string; initial?: string }) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [manage, setManage] = useState(false);
  const account = currentAccount();
  async function signOut() {
    setBusy(true);
    setError(false);
    try {
      await signOutAccount();
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return <>
    <button type="button" className="bot-user" aria-label={`Cuenta de ${username}`} onClick={() => {
      setError(false); setLeaving(false); setManage(false); setOpen(true);
    }}>{initial}</button>
    {open && <BotActionSheet title={username} busy={busy} leaving={leaving} close={() => setOpen(false)} dismiss={() => setLeaving(true)}>
      <Link className="bot-pill" to="/settings">Mis ajustes</Link>
      {account?.role === "admin" && (manage ? <AccountSettingsEditor self={account.sub} /> :
        <button type="button" className="bot-pill" onClick={() => setManage(true)}>Ajustes de otras cuentas</button>)}
      <button type="button" className="bot-pill" disabled={busy} onClick={() => void signOut()}>Cerrar sesión</button>
      {error && <p role="alert">No se pudo cerrar la sesión. Vuelve a intentarlo.</p>}
    </BotActionSheet>}
  </>;
}
