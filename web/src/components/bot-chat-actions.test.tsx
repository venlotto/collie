import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savedBot } from "@/lib/bot-identity";
import { setLocale, t, whenLocaleReady } from "@/lib/i18n";
import { fixtureAgents, fixtureWorkspaces } from "@/test/handlers";
import { server } from "@/test/msw";
import { BotChatBar } from "./bot-chat-bar";

const pane = { ...fixtureAgents[0]!, terminalId: "terminal-chat-menu", workspaceId: "w1" };
const bot = { name: "Design", color: 1, silhouette: 2 };
const destination = { ...fixtureWorkspaces[0]!, workspaceId: "w2", label: "Marketing" };
const onDone = vi.fn(), onChanged = vi.fn();
const writes: { scope: string | null; body: unknown }[] = [];
function mount(writable = true, host?: string, terminalId: string | undefined = pane.terminalId) {
  return render(<BotChatBar bot={bot} pane={{ ...pane, terminalId }} unread={0} pinned={false}
    back={vi.fn()} pin={vi.fn()} terminal={false} actions={{ scope: { session: "design", host }, writable,
      onDone, onChanged }} />);
}
async function open(action: string) {
  await userEvent.click(screen.getByRole("button", { name: t("bot.chat.options") }));
  await userEvent.click(screen.getByText(action));
  return screen.getByRole("dialog", { name: action });
}
beforeEach(() => {
  // jsdom has no native dialog methods; opening/closing only changes its accessibility state here.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  setLocale("en");
  vi.clearAllMocks();
  writes.length = 0;
  server.use(http.get("/api/snapshot", () => HttpResponse.json({ agents: [], shellPanes: [], workspaces: [
    { ...destination, workspaceId: "w1", label: "Current" }, destination,
    { ...destination, workspaceId: "w3", host: "remote", label: "Other machine" },
    { ...destination, workspaceId: "agent-runs", label: "Runs" },
  ] })), http.post("/api/bot-action", async ({ request }) => {
    writes.push({ scope: new URL(request.url).searchParams.get("session"), body: await request.json() });
    return HttpResponse.json({ ok: true });
  }));
});
afterEach(cleanup);

describe("actions from the open chat", () => {
  it("confirms trashing the addressed chat, keeps its portrait, refreshes and leaves the old screen", async () => {
    mount();
    const dialog = await open("Delete chat");
    expect(dialog).toHaveTextContent("Design");
    expect(dialog).toHaveTextContent("15 minutes");
    expect(writes).toEqual([]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete chat" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(writes).toEqual([{ scope: "design", body: { action: "trash", terminalId: pane.terminalId } }]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(savedBot({ session: "design" }, pane.terminalId)).toEqual(bot);
  });
  it("cancels deletion without writing or navigating", async () => {
    mount();
    const dialog = await open("Delete chat");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();
  });
  it("offers only valid destinations and moves the selected chat in its own session", async () => {
    mount();
    const dialog = await open("Change workspace");
    expect(within(dialog).queryByText("Current")).toBeNull();
    expect(within(dialog).queryByText("Other machine")).toBeNull();
    expect(within(dialog).queryByText("Runs")).toBeNull();
    await userEvent.click(await within(dialog).findByRole("button", { name: "Marketing" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(onDone).not.toHaveBeenCalled();
    expect(writes).toEqual([{ scope: "design", body: { action: "move", terminalId: pane.terminalId, workspaceId: "w2" } }]);
  });
  it("keeps the chat open on failure and permits a retry", async () => {
    server.use(http.post("/api/bot-action", () => HttpResponse.json({ error: "Workspace unavailable" }, { status: 409 })));
    mount();
    const dialog = await open("Change workspace");
    await userEvent.click(await within(dialog).findByRole("button", { name: "Marketing" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace unavailable");
    expect(onDone).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(await within(dialog).findByRole("button", { name: "Marketing" })).toBeEnabled();
  });
  it("locks repeat clicks while deletion is pending", async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    let count = 0;
    server.use(http.post("/api/bot-action", async () => { count++; await pending; return HttpResponse.json({ ok: true }); }));
    mount();
    const dialog = await open("Delete chat");
    const confirm = within(dialog).getByRole("button", { name: "Delete chat" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(count).toBe(1));
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    finish();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
  it("disables writes for a read-only chat", async () => {
    mount(false);
    await userEvent.click(screen.getByRole("button", { name: t("bot.chat.options") }));
    expect(screen.getByText("Delete chat")).toBeDisabled();
    expect(screen.getByText("Change workspace")).toBeDisabled();
    expect(writes).toEqual([]);
  });
  it("does not offer local mutations for a remote chat", async () => {
    mount(true, "remote");
    await userEvent.click(screen.getByRole("button", { name: t("bot.chat.options") }));
    expect(screen.queryByText("Delete chat")).toBeNull();
    expect(screen.queryByText("Change workspace")).toBeNull();
  });
});


it("deletes an external bot from the open chat menu without a terminal", async () => {
  const external = { ...pane, paneId: "agent-run:external", terminalId: undefined,
    agentRun: { id: "external", rootId: "external", status: "done" as const, start: 1, end: 2 } };
  render(<BotChatBar bot={bot} pane={external} unread={0} pinned={false} back={vi.fn()} pin={vi.fn()} terminal={false}
    actions={{ scope: {}, writable: true, onDone, onChanged }} />);
  const dialog = await open("Delete chat");
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete chat" }));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  expect(writes).toEqual([{ scope: null, body: { action: "trash", runId: "external" } }]);
});


it("updates every chat-menu label when the chosen language changes", async () => {
  mount();
  expect(screen.getByRole("button", { name: "Chat options" })).toBeInTheDocument();
  await act(async () => { setLocale("es"); await whenLocaleReady("es"); });
  expect(screen.getByRole("button", { name: "Opciones del chat" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Volver a los chats" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Opciones del chat" }));
  expect(screen.getByText("Fijar chat")).toBeInTheDocument();
  expect(screen.getByText("Eliminar chat")).toBeInTheDocument();
  expect(screen.queryByText("Delete chat")).toBeNull();
});
