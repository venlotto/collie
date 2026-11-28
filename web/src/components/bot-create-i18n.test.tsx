import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale, whenLocaleReady } from "@/lib/i18n";
import { fixtureAgents, fixtureWorkspaces } from "@/test/handlers";
import { CreateBot, unassignedTarget } from "./create-bot";
import { botTime } from "./bot-identity";
import { runProgress } from "./agent-run-chat";

vi.mock("@/hooks/use-spaces", () => ({ useSpaceActions: () => ({ start: vi.fn(), creatingSpace: false }) }));
vi.mock("@/lib/mux-capability", () => ({ useMuxCapability: () => ({ capable: true }) }));

afterEach(() => vi.useRealTimers());

it("updates bot editing controls when language changes and keeps workspace identities", async () => {
  setLocale("es");
  await whenLocaleReady("es");
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  render(<CreateBot scope={{}} edit={{ ...fixtureAgents[0]!, terminalId: "editable" }} spaces={fixtureWorkspaces} writable close={vi.fn()} />);
  expect(screen.getByRole("textbox", { name: "Nombre del bot" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Azul" })).toBeInTheDocument();
  await act(async () => { setLocale("en"); await whenLocaleReady("en"); });
  expect(screen.getByRole("textbox", { name: "Bot name" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Blue" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Shape 1" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Unassigned" }));
  expect(unassignedTarget([])).toEqual({ label: "Sin asignar" });
});

it("formats today's label, older dates and run state in the selected language", async () => {
  vi.useFakeTimers();
  const today = new Date(2026, 10, 28, 13, 5);
  const older = new Date(2026, 10, 20, 13, 5);
  vi.setSystemTime(today);
  const run = { id: "test", status: "done", start: 1_000, end: 61_000 } as const;
  setLocale("es");
  await whenLocaleReady("es");
  expect(botTime(today.getTime(), true)).toMatch(/^Hoy /);
  expect(runProgress(run)).toMatch(/^Listo · /);
  setLocale("en");
  await whenLocaleReady("en");
  expect(botTime(today.getTime(), true)).toMatch(/^Today /);
  expect(runProgress(run)).toBe("Done · 1 min");
  expect(botTime(older.getTime())).toBe(older.toLocaleDateString("en", { day: "numeric", month: "short" }));
  setLocale("ja");
  await whenLocaleReady("ja");
  expect(botTime(today.getTime(), true)).toMatch(/^今日 /);
  expect(runProgress(run)).toBe("完了 · 1 分");
  expect(botTime(NaN)).toBe("");
});
