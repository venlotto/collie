import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixtureAgents, fixtureWorkspaces } from "@/test/handlers";
import { server } from "@/test/msw";
import { t } from "@/lib/i18n";
import { wipeDevice } from "@/lib/wipe";
import { MobileAgentHub } from "./mobile-agent-hub";

const spaces = ["Ideas", "Viajes"].map((label, i) => Object.assign({}, fixtureWorkspaces[0]!, { workspaceId: `w${i}`, label }));
const panes = ["Notas", "Bocetos", "Rutas"].map((paneLabel, i) => Object.assign({}, fixtureAgents[0]!, { paneLabel,
  paneId: `p${i}`, terminalId: `t${i}`, workspaceId: i < 2 ? "w0" : "w1", workspaceLabel: i < 2 ? "Ideas" : "Viajes", hasSession: false }));
const props = { panes, workspaces: spaces, writable: true, listScope: {}, onChanged: vi.fn(), scopeOf: () => ({}), onOpen: vi.fn(), onPress: vi.fn() };
beforeEach(() => {
  server.use(http.get("/api/chat-order", () => HttpResponse.json([])));
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await wipeDevice("unpair"); });

it("selects a workspace alongside a pinned bot and never deletes its chats twice", async () => {
  const writes: unknown[] = [];
  server.use(http.post("/api/bot-action", async ({ request }) => { writes.push(await request.json()); return HttpResponse.json({ ok: true }); }));
  const page = render(<MobileAgentHub {...props} featured={panes[2]} />);
  fireEvent.contextMenu(page.getByRole("button", { name: /^Notas/ }));
  fireEvent.click(page.getByRole("checkbox", { name: "Ideas" }));
  expect(page.getByRole("checkbox", { name: /^Notas/ })).toBeChecked();
  expect(page.getByRole("checkbox", { name: /^Notas/ })).toBeDisabled();
  // Both the pinned slot and its row represent one selected bot.
  fireEvent.click(page.getByRole("checkbox", { name: "Rutas" }));
  expect(page.getByText("2 seleccionados")).toBeVisible();
  expect(page.getByRole("button", { name: "Mover" })).toBeDisabled();
  fireEvent.click(page.getByRole("button", { name: "Eliminar" }));
  expect(writes).toEqual([]);
  const dialog = page.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: t("bot.selection.trashConfirm") }));
  await waitFor(() => expect(writes).toEqual([
    { action: "trashWorkspace", workspaceId: "w0" }, { action: "trash", terminalId: "t2" },
  ]));
  expect(props.onOpen).not.toHaveBeenCalled();
});

it("keeps only failed workspaces selected so retry never repeats a completed deletion", async () => {
  const writes: string[] = [];
  let fail = true;
  server.use(http.post<Record<string, never>, { workspaceId: string }>("/api/bot-action", async ({ request }) => {
    const body = await request.json();
    writes.push(body.workspaceId);
    return body.workspaceId === "w1" && fail ? HttpResponse.json({ error: "unavailable" }, { status: 503 }) : HttpResponse.json({ ok: true });
  }));
  const page = render(<MobileAgentHub {...props} />);
  fireEvent.click(page.getByRole("button", { name: "Ideas" }));
  fireEvent.contextMenu(page.getByRole("button", { name: /^Rutas/ }));
  fireEvent.click(page.getByRole("button", { name: "Seleccionar todo" }));
  expect(page.getByRole("checkbox", { name: "Ideas" })).toBeChecked();
  fireEvent.click(page.getByRole("button", { name: "Eliminar" }));
  const confirm = within(page.getByRole("dialog")).getByRole("button", { name: t("bot.selection.trashConfirm") });
  fireEvent.click(confirm);
  await waitFor(() => expect(page.getByRole("alert")).toHaveTextContent("No se pudo completar"));
  expect(writes).toEqual(["w0", "w1"]);
  expect(page.getByRole("checkbox", { name: "Ideas", hidden: true })).not.toBeChecked();
  fail = false;
  fireEvent.click(confirm);
  await waitFor(() => expect(writes).toEqual(["w0", "w1", "w1"]));
});

it("does not enable selection or workspace writes for a read-only device", () => {
  const page = render(<MobileAgentHub {...props} writable={false} />);
  fireEvent.contextMenu(page.getByRole("button", { name: /^Notas/ }));
  fireEvent.contextMenu(page.getByRole("button", { name: "Ideas" }));
  expect(page.queryByRole("checkbox")).toBeNull();
  expect(page.queryByRole("dialog")).toBeNull();
});

it("right-click selects only the chosen external bot without a terminal", async () => {
  const writes: unknown[] = [];
  server.use(http.post("/api/bot-action", async ({ request }) => { writes.push(await request.json()); return HttpResponse.json({ ok: true }); }));
  const external = ["collie claudep long paste", "collie claudep questions"].map((name, i) => Object.assign({}, panes[i]!, {
    paneLabel: name, paneId: "agent-run:run" + i, terminalId: undefined,
    agentRun: { id: "run" + i, rootId: "root" + i, status: "done" as const, start: 1, end: 2 } }));
  const page = render(<MobileAgentHub {...props} panes={external} />);
  fireEvent.contextMenu(page.getByRole("button", { name: /^collie claudep long paste/ }));
  expect(page.getByRole("checkbox", { name: /^collie claudep long paste/ })).toBeChecked();
  expect(page.getByRole("checkbox", { name: /^collie claudep questions/ })).not.toBeChecked();
  fireEvent.click(page.getByRole("button", { name: "Eliminar" }));
  await waitFor(() => expect(writes).toEqual([{ action: "trash", runId: "run0" }]));
  expect(props.onOpen).not.toHaveBeenCalled();
});

it("swiping an external bot sends only that bot to Trash and refreshes the list", async () => {
  const writes: unknown[] = [];
  server.use(http.post("/api/bot-action", async ({ request }) => { writes.push(await request.json()); return HttpResponse.json({ ok: true }); }));
  const external = Object.assign({}, panes[0]!, { paneLabel: "Externo", paneId: "agent-run:external", terminalId: undefined,
    agentRun: { id: "external", rootId: "external", status: "done" as const, start: 1, end: 2 } });
  const page = render(<MobileAgentHub {...props} panes={[external, panes[1]!]} />);
  const row = page.getByRole("button", { name: /^Externo/ });
  const finger = { button: 0, pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 20, clientY: 50 };
  fireEvent.pointerDown(row, finger);
  fireEvent.pointerMove(row, { ...finger, clientX: 150 });
  fireEvent.pointerUp(row, { ...finger, clientX: 150 });
  fireEvent.click(row, { detail: 1 });
  await waitFor(() => expect(writes).toEqual([{ action: "trash", runId: "external" }]));
  expect(props.onChanged).toHaveBeenCalledOnce();
  expect(props.onOpen).not.toHaveBeenCalled();
});
