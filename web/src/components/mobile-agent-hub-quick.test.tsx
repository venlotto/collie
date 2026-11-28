import { setLocale, whenLocaleReady } from "@/lib/i18n";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw";
import { wipeDevice } from "@/lib/wipe";
import { vi } from "vitest";
import { fixtureAgents, fixtureShellPanes, fixtureWorkspaces } from "@/test/handlers";
import { MobileAgentHub } from "./mobile-agent-hub";

beforeEach(async () => { setLocale("es"); await whenLocaleReady("es"); });
const base = {
  panes: [...fixtureAgents, ...fixtureShellPanes], workspaces: fixtureWorkspaces,
  writable: true, listScope: {}, onChanged: vi.fn(),
  scopeOf: () => ({}), onOpen: vi.fn(), onPress: vi.fn(),
};
beforeEach(() => server.use(http.get("/api/chat-order", () => HttpResponse.json([]))));
afterEach(async () => { vi.useRealTimers(); cleanup(); await wipeDevice("unpair"); });

function setup() {
  const onNew = vi.fn();
  const onQuickNew = vi.fn(async (): Promise<string | undefined> => undefined);
  render(<MobileAgentHub {...base} onNew={onNew} onQuickNew={onQuickNew} />);
  return { onNew, onQuickNew, plus: screen.getByRole("button", { name: "Crear nuevo" }) };
}

it("a mouse click makes a quick bot immediately", () => {
  vi.useFakeTimers();
  const { onNew, onQuickNew, plus } = setup();
  fireEvent.pointerDown(plus, { button: 0, pointerType: "mouse" });
  fireEvent.pointerUp(plus, { button: 0, pointerType: "mouse" });
  fireEvent.click(plus, { detail: 1 });
  expect(onNew).not.toHaveBeenCalled();
  expect(onQuickNew).toHaveBeenCalledOnce();
});

it("a double-click makes a quick bot and never opens the sheet", () => {
  vi.useFakeTimers();
  const { onNew, onQuickNew, plus } = setup();
  for (const detail of [1, 2]) {
    fireEvent.pointerDown(plus, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(plus, { button: 0, pointerType: "mouse" });
    fireEvent.click(plus, { detail });
  }
  act(() => { vi.advanceTimersByTime(300); });
  expect(onQuickNew).toHaveBeenCalledOnce();
  expect(onNew).not.toHaveBeenCalled();
});

it("a right-click opens the full sheet", () => {
  const { onNew, onQuickNew, plus } = setup();
  fireEvent.contextMenu(plus);
  expect(onNew).toHaveBeenCalledOnce();
  expect(onQuickNew).not.toHaveBeenCalled();
});

it("a tap makes a quick bot and a hold opens only the sheet", () => {
  vi.useFakeTimers();
  const { onNew, onQuickNew, plus } = setup();
  fireEvent.pointerDown(plus, { button: 0, pointerType: "touch" });
  fireEvent.pointerUp(plus, { button: 0, pointerType: "touch" });
  fireEvent.click(plus, { detail: 1 });
  expect(onQuickNew).toHaveBeenCalledOnce();
  expect(onNew).not.toHaveBeenCalled();
  fireEvent.pointerDown(plus, { button: 0, pointerType: "touch" });
  act(() => { vi.advanceTimersByTime(600); });
  fireEvent.pointerUp(plus, { button: 0, pointerType: "touch" });
  fireEvent.click(plus, { detail: 1 });
  expect(onQuickNew).toHaveBeenCalledOnce();
  expect(onNew).toHaveBeenCalledOnce();
});

it("shows why a quick bot could not be made", async () => {
  const onQuickNew = vi.fn(async () => "No hay agentes disponibles.");
  render(<MobileAgentHub {...base} onNew={vi.fn()} onQuickNew={onQuickNew} />);
  fireEvent.click(screen.getByRole("button", { name: "Crear nuevo" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No hay agentes disponibles.");
});

it("without a quick path every click opens the sheet at once", () => {
  const onNew = vi.fn();
  render(<MobileAgentHub {...base} onNew={onNew} />);
  const plus = screen.getByRole("button", { name: "Crear nuevo" });
  fireEvent.pointerDown(plus, { button: 0, pointerType: "mouse" });
  fireEvent.click(plus, { detail: 1 });
  expect(onNew).toHaveBeenCalledOnce();
});

it("keyboard activation creates a quick bot", () => {
  const { onNew, onQuickNew, plus } = setup();
  fireEvent.click(plus, { detail: 0 });
  expect(onQuickNew).toHaveBeenCalledOnce();
  expect(onNew).not.toHaveBeenCalled();
});

it("while creation is busy neither click nor hold starts an action", () => {
  vi.useFakeTimers();
  const onNew = vi.fn();
  const onQuickNew = vi.fn(async () => undefined);
  render(<MobileAgentHub {...base} onNew={onNew} onQuickNew={onQuickNew} quickBusy />);
  const plus = screen.getByRole("button", { name: "Crear nuevo" });
  expect(plus).toBeDisabled();
  fireEvent.click(plus);
  fireEvent.pointerDown(plus, { button: 0, pointerType: "touch" });
  act(() => { vi.advanceTimersByTime(600); });
  fireEvent.contextMenu(plus);
  expect(onNew).not.toHaveBeenCalled();
  expect(onQuickNew).not.toHaveBeenCalled();
});
