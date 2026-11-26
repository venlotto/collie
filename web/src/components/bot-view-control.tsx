import { Segmented } from "@/components/ui/segmented";
import { useLocale } from "@/hooks/use-locale";
import { t } from "@/lib/i18n";
import type { PaneView } from "@/lib/pane-view";

/** The per-bot body setting, shared by the ⋮ sheet and Display settings. */
export function BotViewControl({ value, onChange }: { value: PaneView; onChange: (view: PaneView) => void }) {
  useLocale();
  return (
    <div data-slot="bot-view-control" className="py-1.5">
      <div className="mb-1.5 text-sm font-medium">{t("chat.mode.view.label")}</div>
      <Segmented
        options={[
          { value: "chat", label: t("chat.mode.option.chat") },
          { value: "terminal", label: t("chat.mode.option.terminal") },
        ]}
        value={value}
        onChange={onChange}
        label={t("chat.mode.view.label")}
        semantics="choice"
      />
      <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{t("chat.mode.bot.help")}</p>
    </div>
  );
}
