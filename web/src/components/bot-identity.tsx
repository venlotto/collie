import { getLocaleSnapshot, t } from "@/lib/i18n";
import { hashId } from "@/lib/hosts";
import { paneName } from "@/lib/pane-name";
import { paneScopeKey, type Scope } from "@/lib/scope";
import type { AgentView } from "@/lib/types";
import { colors, savedBot, silhouetteCount, type BotIdentity } from "@/lib/bot-identity";
export type { BotIdentity } from "@/lib/bot-identity";

const silhouettes = import.meta.glob<string>("./bot-shapes/*.png", { eager: true, query: "?url", import: "default" });
export function BlobAvatar({ silhouette, color, large = false }: { silhouette: number; color: number; large?: boolean }) {
  const index = large && silhouette === 12 ? 13 : silhouette;
  const mask = `url("${silhouettes[`./bot-shapes/${index}.png`]}") center / contain no-repeat`;
  return <span className="bot-avatar" aria-hidden="true" style={{ backgroundColor: colors[color], mask, WebkitMask: mask }} />;
}

export function identityOf(pane: AgentView, scope: Scope): BotIdentity {
  const saved = (pane.terminalId ? savedBot(scope, pane.terminalId) : undefined) ?? savedBot(scope, pane.paneId);
  if (saved) return { ...saved, name: pane.paneLabel || saved.name };
  const seed = hashId(paneScopeKey(scope, pane.paneId));
  return { name: paneName(pane), silhouette: seed % silhouetteCount, color: [8, 5, 3, 9, 7, 10, 6][Math.floor(seed / 7) % 7]! };
}

export function botTime(ms: number, day = false) {
  if (!ms || !Number.isFinite(ms)) return "";
  const date = new Date(ms);
  const today = date.toDateString() === new Date().toDateString();
  const selected = getLocaleSnapshot().locale;
  const locale = selected === "es" ? "es-VE" : selected;
  const clock = date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (today) return day ? t("bot.time.today", { time: clock }) : clock;
  const short = date.toLocaleDateString(locale, { day: "numeric", month: "short" });
  return day ? short + " · " + clock : short;
}
