import { t } from "@/lib/i18n";
import { useCallback, useRef, useState } from "react";
import { fetchLaunchers, renamePane, type SpaceTarget } from "@/lib/api";
import { describeThrownError } from "@/lib/api-error-message";
import { cacheBotPrefs, readBotPrefs } from "@/lib/bot-create-prefs";
import { randomBotName } from "@/lib/bot-default-names";
import { randomBotAppearance, saveBot } from "@/lib/bot-identity";
import { useSpaceActions } from "@/hooks/use-spaces";
import { mintRequestId } from "@/lib/worktree-name";
import type { Scope } from "@/lib/scope";
import { unassignedTarget } from "./create-bot";
import type { WorkspaceView, BotCreatePrefs } from "@/lib/types";

/** Call with active workspaces from the target host/session, never the activity-sorted list. */
export function quickBotTarget(spaces: readonly WorkspaceView[]): SpaceTarget {
  let newest: WorkspaceView | undefined;
  for (const space of spaces) {
    if (space.creationOrder !== undefined &&
        (newest === undefined || space.creationOrder > newest.creationOrder!)) newest = space;
  }
  return newest ? { id: newest.workspaceId } : unassignedTarget(spaces);
}

/**
 * A bot in one gesture: no sheet, the most recently created active workspace, a random name that
 * gives way to the agent's own title for the work, and the agent and reasoning of the last bot created on that machine. `quick` resolves to the error to
 * show, or `undefined` when the bot opened (the phone moves to it) or another create was in flight.
 */
export function useQuickBot({ canRename }: { canRename: boolean }) {
  const { start, creatingSpace } = useSpaceActions();
  const [preparing, setPreparing] = useState(false);
  const inFlight = useRef(false);
  const quick = useCallback(async (scope: Scope, space: SpaceTarget, taken: ReadonlySet<string>): Promise<string | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setPreparing(true);
    try {
      const catalog = await fetchLaunchers({ host: scope.host, session: scope.session });
      const profiles = catalog.botCreate;
      const last = profiles?.last ?? readBotPrefs(scope.host);
      const profile = profiles?.agents.find(a => a.id === last.agent) ?? profiles?.agents[0];
      if (profiles && !profile) return t("bot.create.noAgents");
      const prefs: BotCreatePrefs | undefined = profile && { agent: profile.id, effort: profile.efforts.includes(last.effort) ? last.effort : "high" };
      const harness = catalog.harnesses?.find(h => h.found);
      const outcome = await start({
        what: profile && prefs ? { kind: "harness", id: profile.harness, botCreate: prefs }
          : harness ? { kind: "harness", id: harness.id } : { kind: "shell" },
        legacyShell: catalog.harnesses === undefined,
        space, requestId: mintRequestId(),
      }, scope);
      if (outcome.kind === "refused") return outcome.message || undefined;
      if (outcome.kind === "unknown") return t("bot.create.unconfirmed");
      if (!outcome.paneId) return undefined;
      if (prefs) cacheBotPrefs(scope.host, prefs);
      const name = randomBotName(taken);
      saveBot(scope, outcome.paneId, {
        name,
        ...randomBotAppearance(),
      });
      // `auto`: a placeholder, so the bridge renames the bot once its agent titles the work.
      if (canRename) void renamePane(outcome.paneId, name, scope, true).catch(() => undefined);
      return undefined;
    } catch (err) {
      return describeThrownError(err);
    } finally {
      inFlight.current = false;
      setPreparing(false);
    }
  }, [start, canRename]);
  return { quick, busy: preparing || creatingSpace };
}
