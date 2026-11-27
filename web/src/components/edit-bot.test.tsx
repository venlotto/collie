import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixtureAgents, fixtureWorkspaces } from "@/test/handlers";
import { savedBot } from "@/lib/bot-identity";
import { CreateBot } from "./create-bot";
import { BotChatBar } from "./bot-chat-bar";

const start = vi.fn();
const rename = vi.fn();
const move = vi.fn();
vi.mock("@/hooks/use-spaces", () => ({ useSpaceActions: () => ({ start, creatingSpace: false }) }));
vi.mock("@/lib/mux-capability", () => ({ useMuxCapability: () => ({ capable: true }) }));
vi.mock("@/lib/api", async real => ({ ...await real<typeof import("@/lib/api")>(), renamePane: (...args: unknown[]) => rename(...args), actOnBot: (...args: unknown[]) => move(...args) }));
beforeEach(() => {
  rename.mockReset().mockResolvedValue({ ok: true });
  move.mockReset().mockResolvedValue({ ok: true });
  start.mockClear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("edits an existing bot without offering or starting another agent", async () => {
  const pane = { ...fixtureAgents[0]!, terminalId: "edit-terminal" };
  render(<CreateBot scope={{}} edit={pane} spaces={fixtureWorkspaces} writable close={vi.fn()} />);
  expect(screen.queryByRole("group", { name: "Agente" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Reasoning" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Nombre del bot" }), { target: { value: "Nuevo nombre" } });
  fireEvent.click(screen.getByRole("button", { name: "Forma 2" }));
  fireEvent.submit(screen.getByRole("textbox", { name: "Nombre del bot" }).closest("form")!);
  await waitFor(() => expect(rename).toHaveBeenCalledWith(pane.paneId, "Nuevo nombre", {}));
  await waitFor(() => expect(savedBot({}, "edit-terminal")?.name).toBe("Nuevo nombre"));
  expect(savedBot({}, "edit-terminal")?.silhouette).toBe(1);
  expect(start).not.toHaveBeenCalled();
  expect(move).not.toHaveBeenCalled();
});

it("opens editing from the title context gesture, never from a plain tap", () => {
  const edit = vi.fn();
  render(<BotChatBar bot={{ name: "Bot prueba", color: 1, silhouette: 2 }} pane={fixtureAgents[0]!}
    edit={edit} unread={0} pinned={false} back={vi.fn()} pin={vi.fn()} terminal={false} />);
  fireEvent.click(screen.getByText("Bot prueba"));
  expect(edit).not.toHaveBeenCalled();
  fireEvent.contextMenu(screen.getByText("Bot prueba"));
  expect(edit).toHaveBeenCalledOnce();
});

it("moves to the chosen workspace and keeps a failed move open", async () => {
  move.mockResolvedValue({ ok: false });
  const pane = { ...fixtureAgents[0]!, terminalId: "move-terminal" };
  const destination = { ...fixtureWorkspaces[0]!, workspaceId: "destination", label: "Destino" };
  render(<CreateBot scope={{}} edit={pane} spaces={[...fixtureWorkspaces, destination]} writable close={vi.fn()} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Workspace existente" }), { target: { value: "destination" } });
  fireEvent.submit(screen.getByRole("textbox", { name: "Nombre del bot" }).closest("form")!);
  await waitFor(() => expect(move).toHaveBeenCalledWith("move", pane, {}, "destination"));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).not.toHaveAttribute("data-leaving", "true");
  expect(start).not.toHaveBeenCalled();
});
