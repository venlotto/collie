import { useState } from "react";
import { Link, useParams, useRevalidator } from "react-router";
import { CreateBot, unassignedTarget } from "@/components/create-bot";
import { MobileAgentHub } from "@/components/mobile-agent-hub";
import { useQuickBot } from "@/components/quick-bot";
import { identityOf } from "@/components/bot-identity";
import { useMuxCapability } from "@/lib/mux-capability";
import { mounted } from "@/lib/base-path";
import { PROXY_AUTH_PATH } from "@/lib/sw-routes";
import { t } from "@/lib/i18n";
import { stampTopology } from "@/lib/poll-intent";
import { useNav } from "@/hooks/use-nav";
import { findPane, paneScope } from "@/lib/hosts";
import { prefetchPaneData } from "@/lib/loaders";
import { pairedDevicesPath, panePath } from "@/lib/nav";
import { useBotFeatured, featuredBotPane, useLegacyPinMigration } from "@/lib/bot-featured";
import { usePairing } from "@/lib/pairing";
import { useRootData } from "@/lib/route-data";
import type { Scope } from "@/lib/scope";
import { activeBotWorkspaces } from "@/lib/bot-workspaces";
import { isReadOnly, type AgentView } from "@/lib/types";

export function HomeRoute() {
  const data = useRootData();
  const revalidator = useRevalidator();
  const nav = useNav();
  const { paneId } = useParams();
  const { refused } = usePairing();
  const { featured: pinnedTop } = useBotFeatured();
  const [create, setCreate] = useState<{ scope: Scope; beside?: AgentView } | null>(null);
  const panes = [...data.agents, ...data.shellPanes];
  const scopeOf = (pane: AgentView) => paneScope(data.scope, pane, data.servers, data.sessions);
  const active = paneId ? findPane(panes, paneId, data.scope, data.servers, data.sessions) : undefined;
  const visible = panes.filter(p => !p.trash);
  useLegacyPinMigration(visible);
  const featured = featuredBotPane(visible, pinnedTop);
  const rename = useMuxCapability("renamePane", data.scope);
  const quickBot = useQuickBot({ canRename: rename.capable });
  const createSpaces = activeBotWorkspaces(data.workspaces, panes, data.scope, data.servers, data.sessions);
  const writable = !refused && !data.authError && !isReadOnly(data.device) && !data.error && !data.stale && data.bridge === "connected";
  const accessNotice = refused ? (
    <p className="bot-access" role="status">Dispositivo sin emparejar <Link to={pairedDevicesPath(data.scope)}>Emparejar</Link></p>
  ) : data.authError ? (
    <p className="bot-access" role="status">Acceso restringido <a href={mounted(PROXY_AUTH_PATH)}>{t("connection.auth.signIn")}</a></p>
  ) : isReadOnly(data.device) ? <p className="bot-access" role="status">{t("space.readOnly.deviceUnauthorised")}</p> : null;
  return <>
    <MobileAgentHub onChanged={() => { stampTopology(); void revalidator.revalidate(); }} writable={writable} listScope={data.scope} panes={panes} workspaces={data.workspaces} scopeOf={scopeOf} active={active} featured={featured}
      deviceName={data.device?.device?.trim()} accessNotice={accessNotice}
      onPress={p => { if (!p.agentRun) void prefetchPaneData(p.paneId, scopeOf(p)); }}
      onOpen={p => nav.open(panePath(p.paneId, scopeOf(p)), { freshPane: p })}
      onQuickNew={writable ? () => quickBot.quick(data.scope, unassignedTarget(createSpaces), new Set(visible.map(p => identityOf(p, scopeOf(p)).name))) : undefined} quickBusy={quickBot.busy}
      onNew={writable || accessNotice ? () => setCreate({ beside: featured?.paneId.startsWith("agent-run:") ? undefined : featured, scope: data.scope }) : undefined} />
    {create && <CreateBot {...create} spaces={createSpaces} writable={writable} close={() => setCreate(null)} />}
  </>;
}
