import { act, renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { BOT_DEFAULT_NAMES } from "@/lib/bot-default-names";
import { cacheBotPrefs } from "@/lib/bot-create-prefs";
import { activeBotWorkspaces } from "@/lib/bot-workspaces";
import { fixtureAgents, fixtureWorkspaces } from "@/test/handlers";
import { savedBot } from "@/lib/bot-identity";
import { quickBotTarget, useQuickBot } from "./quick-bot";

const start = vi.fn();
const renamePane = vi.fn();
const fetchLaunchers = vi.fn();
vi.mock("@/hooks/use-spaces", () => ({ useSpaceActions: () => ({ start, creatingSpace: false }) }));
vi.mock("@/lib/api", async (real) => ({ ...await real<typeof import("@/lib/api")>(), fetchLaunchers: (...a: unknown[]) => fetchLaunchers(...a), renamePane: (...a: unknown[]) => renamePane(...a) }));

const agents = [
  { id: "codexp", harness: "codex", efforts: ["low", "high"] },
  { id: "claudep", harness: "claude", efforts: ["medium", "high", "max"] },
];
beforeEach(() => {
  localStorage.clear();
  start.mockReset().mockResolvedValue({ kind: "done", paneId: "p9" });
  renamePane.mockReset().mockResolvedValue({ ok: true });
  fetchLaunchers.mockReset().mockResolvedValue({ harnesses: [], botCreate: { agents, last: { agent: "claudep", effort: "max" } } });
});

it("starts the last agent in the given workspace, a free random name the bridge may replace", async () => {
  const { result } = renderHook(() => useQuickBot({ canRename: true }));
  const taken = new Set(BOT_DEFAULT_NAMES.slice(1));
  let error: string | undefined = "unset";
  await act(async () => { error = await result.current.quick({}, { label: "Sin asignar" }, taken); });
  expect(error).toBeUndefined();
  const [ask] = start.mock.calls[0]!;
  expect(ask.what).toEqual({ kind: "harness", id: "claude", botCreate: { agent: "claudep", effort: "max" } });
  expect(ask.beside).toBeUndefined();
  expect(ask.space).toEqual({ label: "Sin asignar" });
  expect(renamePane).toHaveBeenCalledWith("p9", BOT_DEFAULT_NAMES[0], {}, true);
  expect(savedBot({}, "p9")?.name).toBe(BOT_DEFAULT_NAMES[0]);
});

it("says why when the machine offers no agent, and starts nothing", async () => {
  fetchLaunchers.mockResolvedValue({ harnesses: [], botCreate: { agents: [] } });
  const { result } = renderHook(() => useQuickBot({ canRename: true }));
  let error: string | undefined;
  await act(async () => { error = await result.current.quick({}, { id: "w7" }, new Set()); });
  expect(error).toBe("No hay agentes disponibles.");
  expect(start).not.toHaveBeenCalled();
});


it("saves a new random appearance for every quick creation", async () => {
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  try {
    const { result } = renderHook(() => useQuickBot({ canRename: true }));
    await act(async () => { await result.current.quick({}, { label: "Sin asignar" }, new Set()); });
    expect(savedBot({}, "p9")).toMatchObject({ silhouette: 0, color: 8 });
    random.mockReturnValue(0.999);
    start.mockResolvedValue({ kind: "done", paneId: "p10" });
    await act(async () => { await result.current.quick({}, { label: "Sin asignar" }, new Set()); });
    expect(savedBot({}, "p10")).toMatchObject({ silhouette: 12, color: 4 });
  } finally { random.mockRestore(); }
});

const workspace = (workspaceId: string, creationOrder: number, number: number) => ({
  ...fixtureWorkspaces[0]!, workspaceId, creationOrder, number,
});

it("one click uses the server's last agent and newest workspace after reordering", async () => {
  cacheBotPrefs(undefined, { agent: "codexp", effort: "low" });
  const spaces = [workspace("w10", 36, 1), workspace("wZ", 35, 3), workspace("w2", 2, 2)];
  const { result } = renderHook(() => useQuickBot({ canRename: true }));
  await act(async () => { await result.current.quick({}, quickBotTarget(spaces), new Set()); });
  expect(start).toHaveBeenCalledWith(expect.objectContaining({
    space: { id: "w10" },
    what: { kind: "harness", id: "claude", botCreate: { agent: "claudep", effort: "max" } },
  }), {});
});

it("ignores a newer trashed workspace and workspaces on another host", () => {
  const spaces = [workspace("w1", 1, 3), workspace("w3", 3, 1), workspace("w2", 2, 2),
    { ...workspace("remote", 99, 4), host: "peer" }];
  const trashed = { ...fixtureAgents[0]!, workspaceId: "w3", trash: {
    trashedAt: 1, originalWorkspaceId: "w3",
    workspaceLabel: "Trash",
  } };
  expect(quickBotTarget(activeBotWorkspaces(spaces, [trashed], {}))).toEqual({ id: "w2" });
});

it("falls back to Sin asignar when no workspace has creation metadata", () => {
  expect(quickBotTarget([])).toEqual({ label: "Sin asignar" });
  expect(quickBotTarget([{ ...fixtureWorkspaces[0]!, label: "Sin asignar" }]))
    .toEqual({ id: fixtureWorkspaces[0]!.workspaceId });
});
