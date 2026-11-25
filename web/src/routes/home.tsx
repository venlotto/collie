import { useState } from "react";
import { useParams } from "react-router";
import { CreateBot } from "@/components/create-bot";
import { MobileAgentHub } from "@/components/mobile-agent-hub";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { useNav } from "@/hooks/use-nav";
import { findPane, paneScope } from "@/lib/hosts";
import { prefetchPaneData } from "@/lib/loaders";
import { panePath } from "@/lib/nav";
import { usePairing } from "@/lib/pairing";
import { pinMatcher, usePins } from "@/lib/pins";
import { useRootData } from "@/lib/route-data";
import type { Scope } from "@/lib/scope";
import { isReadOnly, type AgentView } from "@/lib/types";

export function HomeRoute() {
  const data = useRootData();
  const nav = useNav();
  const { paneId } = useParams();
  const { refused } = usePairing();
  const pins = usePins();
  const [create, setCreate] = useState<{ scope: Scope; beside?: AgentView } | null>(null);
  const panes = [...data.agents, ...data.shellPanes];
  const scopeOf = (pane: AgentView) => paneScope(data.scope, pane, data.servers, data.sessions);
  const active = paneId ? findPane(panes, paneId, data.scope, data.servers, data.sessions) : undefined;
  const featured = active ?? panes.find(pinMatcher(pins)) ?? panes.find(p => p.focused) ?? panes[0];
  const writable = !refused && !isReadOnly(data.device) && !data.error && !data.stale && data.bridge === "connected";
  return <>
    <ReadOnlyBanner device={data.device} />
    <MobileAgentHub panes={panes} workspaces={data.workspaces} scopeOf={scopeOf} active={active} featured={featured} user={data.device?.device ?? undefined}
      onPress={p => { void prefetchPaneData(p.paneId, scopeOf(p)); }}
      onOpen={p => nav.open(panePath(p.paneId, scopeOf(p)), { freshPane: p })}
      onNew={writable ? () => setCreate({ beside: featured, scope: featured ? scopeOf(featured) : data.scope }) : undefined} />
    {create && <CreateBot {...create} close={() => setCreate(null)} />}
  </>;
}
