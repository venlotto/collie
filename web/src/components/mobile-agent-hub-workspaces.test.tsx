import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixtureAgents, fixtureWorkspaces } from "@/test/handlers";
import { server } from "@/test/msw";
import { wipeDevice } from "@/lib/wipe";
import { MobileAgentHub } from "./mobile-agent-hub";

const workspaces = ["Duck Race", "Nexo", "Optimización koper"].map((label, index) => Object.assign({}, fixtureWorkspaces[0]!, {
  workspaceId: `w${index}`, number: index + 1, label,
}));
const panes = workspaces.map((space, index) => ({ ...fixtureAgents[0]!,
  paneId: `p${index}`, terminalId: `terminal-${index}`, workspaceId: space.workspaceId,
  workspaceLabel: space.label, lastActiveAt: (index + 1) * 100, hasSession: false,
  agentRun: { id: `external-${index}`, status: "done" as const, start: 1, end: (index + 1) * 100 },
}));
const props = { panes, workspaces, writable: true, listScope: {}, scopeOf: () => ({}),
  onChanged: vi.fn(), onOpen: vi.fn(), onPress: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  server.use(http.get("/api/chat-order", () => HttpResponse.json([])));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(async () => { cleanup(); await wipeDevice("unpair"); });

it("shows Duck Race first and moves an external workspace using the displayed positions", async () => {
  const writes: unknown[] = [];
  server.use(http.post("/api/space/w2/move", async ({ request }) => {
    writes.push(await request.json()); return HttpResponse.json({ ok: true });
  }));
  const page = render(<MobileAgentHub {...props} />);
  const headings = () => [...page.container.querySelectorAll("section .bot-group")].map(node => node.textContent);
  expect(headings()).toEqual(["Duck Race", "Nexo", "Optimización koper"]);
  fireEvent.click(page.getByRole("button", { name: "Opciones de Optimización koper" }));
  fireEvent.click(page.getByRole("button", { name: "Mover" }));
  expect(page.getByLabelText("Posición")).toHaveValue("2");
  fireEvent.change(page.getByLabelText("Posición"), { target: { value: "0" } });
  await waitFor(() => expect(props.onChanged).toHaveBeenCalledTimes(1));
  expect(writes).toEqual([{ before: "w0" }]);
  page.rerender(<MobileAgentHub {...props} workspaces={[workspaces[2]!, workspaces[0]!, workspaces[1]!]} />);
  expect(headings()).toEqual(["Optimización koper", "Duck Race", "Nexo"]);
});

it("confirms deleting an external workspace and then shows its chats together in trash", async () => {
  const writes: unknown[] = [];
  server.use(http.post("/api/bot-action", async ({ request }) => {
    writes.push(await request.json()); return HttpResponse.json({ ok: true });
  }));
  const page = render(<MobileAgentHub {...props} />);
  fireEvent.click(page.getByRole("button", { name: "Opciones de Nexo" }));
  fireEvent.click(page.getByRole("button", { name: "Eliminar workspace" }));
  const dialog = page.getByRole("dialog");
  expect(dialog).toHaveTextContent("15 minutos");
  expect(writes).toEqual([]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Enviar a Papelera" }));
  await waitFor(() => expect(props.onChanged).toHaveBeenCalledTimes(1));
  expect(writes).toEqual([{ action: "trashWorkspace", workspaceId: "w1" }]);
  page.rerender(<MobileAgentHub {...props} panes={panes.map(p => p.workspaceId === "w1" ? Object.assign({}, p, {
    trash: { originalWorkspaceId: "w1", workspaceLabel: "Nexo", trashedAt: Date.now() },
  }) : p)} />);
  expect([...page.container.querySelectorAll("section .bot-group")].map(node => node.textContent)).toEqual(["Duck Race", "Optimización koper", "Papelera"]);
  expect(page.getByRole("button", { name: "Restaurar workspace" })).toBeVisible();
});

it("keeps workspace actions unavailable for a read-only device", () => {
  const page = render(<MobileAgentHub {...props} writable={false} />);
  expect(page.queryByRole("button", { name: /^Opciones de / })).toBeNull();
  fireEvent.contextMenu(page.getByRole("button", { name: "Nexo" }));
  expect(page.queryByRole("dialog")).toBeNull();
});
