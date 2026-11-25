import { useState } from "react";
import { Link, useParams, useRevalidator } from "react-router";
import { CreateBot } from "@/components/create-bot";
import { MobileAgentHub } from "@/components/mobile-agent-hub";
import { mounted } from "@/lib/base-path";
import { PROXY_AUTH_PATH } from "@/lib/sw-routes";
import { t } from "@/lib/i18n";
import { useNav } from "@/hooks/use-nav";
import { findPane, paneScope } from "@/lib/hosts";
import { prefetchPaneData } from "@/lib/loaders";
import { pairedDevicesPath, panePath } from "@/lib/nav";
import { usePairing } from "@/lib/pairing";
import { pinMatcher, usePins } from "@/lib/pins";
import { useRootData } from "@/lib/route-data";
import type { Scope } from "@/lib/scope";
import { isReadOnly, type AgentView } from "@/lib/types";

export function HomeRoute() {
  const data = useRootData();
  const revalidator = useRevalidator();
  const nav = useNav();
  const { paneId } = useParams();
  const { refused } = usePairing();
  const pins = usePins();
  const [create, setCreate] = useState<{ scope: Scope; beside?: AgentView } | null>(null);
  const panes = [...data.agents, ...data.shellPanes];
  const scopeOf = (pane: AgentView) => paneScope(data.scope, pane, data.servers, data.sessions);
  const active = paneId ? findPane(panes, paneId, data.scope, data.servers, data.sessions) : undefined;
  const featured = panes.find(pinMatcher(pins)) ?? panes.find(p => p.focused) ?? panes[0];
  const writable = !refused && !data.authError && !isReadOnly(data.device) && !data.error && !data.stale && data.bridge === "connected";
  const accessNotice = refused ? (
    <p className="bot-access" role="status">Dispositivo sin emparejar <Link to={pairedDevicesPath(data.scope)}>Emparejar</Link></p>
  ) : data.authError ? (
    <p className="bot-access" role="status">Acceso restringido <a href={mounted(PROXY_AUTH_PATH)}>{t("connection.auth.signIn")}</a></p>
  ) : isReadOnly(data.device) ? <p className="bot-access" role="status">{t("space.readOnly.deviceUnauthorised")}</p> : null;
  return <>
    <MobileAgentHub writable={writable} listScope={data.scope} refresh={() => { void revalidator.revalidate(); }} panes={panes} workspaces={data.workspaces} scopeOf={scopeOf} active={active} featured={featured}
      deviceName={data.device?.device?.trim()} accessNotice={accessNotice}
      onPress={p => { void prefetchPaneData(p.paneId, scopeOf(p)); }}
      onOpen={p => nav.open(panePath(p.paneId, scopeOf(p)), { freshPane: p })}
      onNew={writable || accessNotice ? () => setCreate({ beside: featured, scope: featured ? scopeOf(featured) : data.scope }) : undefined} />
    {create && <CreateBot {...create} writable={writable} close={() => setCreate(null)} />}
  </>;
}
