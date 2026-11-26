import { t } from "@/lib/i18n";
import { useLocale } from "@/hooks/use-locale";
import type { ActivityStatus } from "@/lib/activity-status";
import { BlobAvatar, type BotIdentity } from "./bot-identity";

export function activityLabel(status: ActivityStatus): string {
  return status === "idle" ? "" : t(`bot.activity.${status}`);
}

export function BotActivityAvatar({ bot, status }: { bot: BotIdentity; status: ActivityStatus }) {
  return <span className="bot-activity-avatar" data-activity={status} aria-hidden="true">
    <BlobAvatar {...bot} />
  </span>;
}

export function BotActivityPill({ bot, status }: { bot: BotIdentity; status: ActivityStatus }) {
  useLocale();
  const label = activityLabel(status);
  return <div className="bot-pill" title={label || undefined}>
    <BotActivityAvatar bot={bot} status={status} /><strong>{bot.name}</strong>
    <span className="sr-only" role="status">{label}</span>
  </div>;
}
