import { act, renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { BOT_DEFAULT_NAMES } from "@/lib/bot-default-names";
import { savedBot } from "@/lib/bot-identity";
import { useQuickBot } from "./quick-bot";

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

it("starts the last agent with no workspace, a free random name the bridge may replace", async () => {
  const { result } = renderHook(() => useQuickBot({ canRename: true }));
  const taken = new Set(BOT_DEFAULT_NAMES.slice(1));
  let error: string | undefined = "unset";
  await act(async () => { error = await result.current.quick({}, taken); });
  expect(error).toBeUndefined();
  const [ask] = start.mock.calls[0]!;
  expect(ask.what).toEqual({ kind: "harness", id: "claude", botCreate: { agent: "claudep", effort: "max" } });
  expect(ask.beside).toBeUndefined();
  expect(renamePane).toHaveBeenCalledWith("p9", BOT_DEFAULT_NAMES[0], {}, true);
  expect(savedBot({}, "p9")?.name).toBe(BOT_DEFAULT_NAMES[0]);
});

it("says why when the machine offers no agent, and starts nothing", async () => {
  fetchLaunchers.mockResolvedValue({ harnesses: [], botCreate: { agents: [] } });
  const { result } = renderHook(() => useQuickBot({ canRename: true }));
  let error: string | undefined;
  await act(async () => { error = await result.current.quick({}, new Set()); });
  expect(error).toBe("No hay agentes disponibles.");
  expect(start).not.toHaveBeenCalled();
});
