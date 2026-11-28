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

export function BotActivityPill({ bot, status, onClick }: { bot: BotIdentity; status: ActivityStatus; onClick?: () => void }) {
  useLocale();
  const label = activityLabel(status);
  const delivery = status === "sendFailed" || status === "sendUnknown" || status === "sending";
  const Tag = onClick ? "button" : "div";
  return <Tag className="bot-pill" title={label || undefined} type={onClick ? "button" : undefined} onClick={onClick} aria-haspopup={onClick ? "dialog" : undefined}>
    <BotActivityAvatar bot={bot} status={status} />
    {delivery ? <span className="bot-pill-copy"><strong>{bot.name}</strong><span role="status" data-activity={status}>{label}</span></span>
      : <><strong>{bot.name}</strong><span className="sr-only" role="status">{label}</span></>}
  </Tag>;
}
