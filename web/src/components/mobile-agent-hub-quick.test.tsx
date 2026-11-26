import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw";
import { wipeDevice } from "@/lib/wipe";
import { vi } from "vitest";
import { fixtureAgents, fixtureShellPanes, fixtureWorkspaces } from "@/test/handlers";
import { MobileAgentHub } from "./mobile-agent-hub";

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

it("a mouse click opens the sheet once the double-click window passes", () => {
  vi.useFakeTimers();
  const { onNew, onQuickNew, plus } = setup();
  fireEvent.pointerDown(plus, { button: 0, pointerType: "mouse" });
  fireEvent.pointerUp(plus, { button: 0, pointerType: "mouse" });
  fireEvent.click(plus, { detail: 1 });
  expect(onNew).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(300); });
  expect(onNew).toHaveBeenCalledOnce();
  expect(onQuickNew).not.toHaveBeenCalled();
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

it("a right-click makes a quick bot", () => {
  const { onNew, onQuickNew, plus } = setup();
  fireEvent.contextMenu(plus);
  expect(onQuickNew).toHaveBeenCalledOnce();
  expect(onNew).not.toHaveBeenCalled();
});

it("a tap opens the sheet at once and a hold makes a quick bot", () => {
  vi.useFakeTimers();
  const { onNew, onQuickNew, plus } = setup();
  fireEvent.pointerDown(plus, { button: 0, pointerType: "touch" });
  fireEvent.pointerUp(plus, { button: 0, pointerType: "touch" });
  fireEvent.click(plus, { detail: 1 });
  expect(onNew).toHaveBeenCalledOnce();
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
  fireEvent.contextMenu(screen.getByRole("button", { name: "Crear nuevo" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No hay agentes disponibles.");
});

it("without a quick path every click opens the sheet at once", () => {
  const onNew = vi.fn();
  render(<MobileAgentHub {...base} onNew={onNew} />);
  const plus = screen.getByRole("button", { name: "Crear nuevo" });
  fireEvent.pointerDown(plus, { button: 0, pointerType: "mouse" });
  fireEvent.click(plus, { detail: 1 });
  fireEvent.contextMenu(plus);
  expect(onNew).toHaveBeenCalledOnce();
});
