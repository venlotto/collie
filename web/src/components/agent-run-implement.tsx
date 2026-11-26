import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useLocale } from "@/hooks/use-locale";
import { BOT_CREATE_PROFILES } from "@/lib/bot-create-profiles";
import { t } from "@/lib/i18n";

export function AgentRunImplementSheet({ plan, originalAgent, busy, onClose, onConfirm }: {
  plan: string; originalAgent: string | undefined; busy: boolean; onClose: () => void;
  onConfirm: (agent: string, effort: string) => void;
}) {
  useLocale();
  const original = BOT_CREATE_PROFILES.find(profile => profile.id === originalAgent);
  const [agent, setAgent] = useState(original?.id ?? BOT_CREATE_PROFILES[0]!.id);
  const [effort, setEffort] = useState("high");
  const profile = BOT_CREATE_PROFILES.find(row => row.id === agent) ?? BOT_CREATE_PROFILES[0]!;
  return <BottomSheet open onClose={onClose} title={t("agentRun.implement.title")}>
    <div className="flex flex-col gap-4" data-slot="agent-run-implement-confirm">
      <p className="text-sm">{t("agentRun.implement.body", { plan, agent })}</p>
      <div className="bot-launch-fields">
        <fieldset disabled={busy} aria-label={t("agentRun.implement.agent")}>
          <legend>{t("agentRun.implement.agent")}</legend>
          {BOT_CREATE_PROFILES.map(row => <button type="button" key={row.id} aria-pressed={row.id === agent}
            onClick={() => { setAgent(row.id); if (!row.efforts.includes(effort)) setEffort("high"); }}>{row.id}</button>)}
        </fieldset>
        <fieldset disabled={busy} aria-label={t("agentRun.implement.effort")}>
          <legend>{t("agentRun.implement.effort")}</legend>
          {profile.efforts.map(row => <button type="button" key={row} aria-pressed={row === effort} onClick={() => setEffort(row)}>{row}</button>)}
        </fieldset>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-11 flex-1" disabled={busy} onClick={onClose}>{t("dialog.cancel")}</Button>
        <Button type="button" className="h-11 flex-1" disabled={busy} onClick={() => onConfirm(agent, effort)}>
          {busy ? t("agentRun.implement.launching") : t("agentRun.implement.action")}
        </Button>
      </div>
    </div>
  </BottomSheet>;
}
