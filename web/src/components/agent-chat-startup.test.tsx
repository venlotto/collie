import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState, type ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";

import { fixtureAgents, sendAnswer, sendHandler } from "@/test/handlers";
import { server } from "@/test/setup";
import { withHeaderHost } from "@/test/header-host";
import { collieMark } from "@/test/collie-mark";
import { clearStatus } from "@/lib/status";
import { http, HttpResponse } from "msw";
import { paneScopeKey } from "@/lib/scope";
import { UNREAD_SURFACE } from "@/lib/send-slot";
import { readAgentLaunch, type AgentLaunch } from "@/lib/agent-startup";
import type { AgentView } from "@/lib/types";
import type { Surface } from "@/lib/surface/surface";
import { runShortcutAction } from "@/lib/shortcuts/registry";
import { AgentChat } from "./agent-chat";

const liveness = vi.hoisted(() => ({ live: true }));
vi.mock("@/lib/liveness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/liveness")>()),
  isLive: () => liveness.live,
  useLive: () => liveness.live,
}));

const TRUST = readFileSync(join(process.cwd(), "src/fixtures/panes/kiro--v3-workspace-trust-continue-w120.txt"), "utf8");
const READY = readFileSync(join(process.cwd(), "src/fixtures/panes/kiro--v3-idle-w120.txt"), "utf8");
const FREE: Surface = { revision: 0, turn: "idle", composer: "empty", modal: "none" };
const ASK: Surface = { revision: 1, turn: "unknown", composer: "unknown", modal: { ask: { id: "trust", kind: "permission", channel: "keys", hash: "abc", options: [{ id: "1", label: "Yes, I trust this folder" }] } } };
const paneId = fixtureAgents[0]!.paneId;
const launch: AgentLaunch = { id: "intent", paneKey: paneScopeKey(undefined, paneId), harness: "kiro" };
const known: AgentView = { ...fixtureAgents[0]!, agent: "kiro", kind: "agent", status: "unknown", surface: UNREAD_SURFACE, sendProtocol: true };
const shell: AgentView = { ...known, agent: "shell", kind: "shell" };

function mount(overrides: Partial<ComponentProps<typeof AgentChat>> = {}) {
  let update = (_props: Partial<ComponentProps<typeof AgentChat>>) => {};
  const onReady = vi.fn();
  function View() {
    const [props, setProps] = useState<ComponentProps<typeof AgentChat>>({ paneId, agent: known, agents: [], shellPanes: [], tabs: [], text: "$ kiro", revision: 0,
      agentLaunch: launch, onBack: vi.fn(), onSelect: vi.fn(), onLaunchReady: onReady, ...overrides });
    update = (next) => setProps((prev) => ({ ...prev, ...next }));
    return withHeaderHost(<AgentChat {...props} />);
  }
  const router = createMemoryRouter([{ path: "/", element: <View /> }, { path: "/pane/:id", element: <span>launched pane</span> }]);
  render(<RouterProvider router={router} />);
  return { router, update: (props: Partial<ComponentProps<typeof AgentChat>>) => act(() => update(props)), onReady };
}

// What the header says while a launch starts: "Starting…" in the title slot (the only place it is
// said now, the composer carries no notice) and the second bead's colour on the mark.
const startingTitle = () => document.querySelector('[data-slot="header-condition"]');
const startingBeads = () => collieMark(document.body)?.style.getPropertyValue("--mark-bead-1");

beforeEach(() => {
  // An event status ("Sent ✓" from the case before) would take the title slot over the condition.
  clearStatus();
  liveness.live = true;
  server.use(http.get("/api/sent", () => HttpResponse.json({ rows: [], next: null })));
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});

describe("AgentChat: a launch's startup gate", () => {
  it("keeps the field editable while the launched pane's capabilities have not arrived", () => {
    mount({ agent: undefined });
    const box = screen.getByRole("textbox");
    expect(box).not.toBeDisabled();
    expect(box).not.toHaveAttribute("placeholder", expect.stringContaining("COLLIE_SEND_PROTOCOL"));
    fireEvent.change(box, { target: { value: "keep this first message" } });
    expect(box).toHaveValue("keep this first message");
  });

  it.each([false, true])("keeps the draft editable and sends through the ordinary protocol before the first screen (inStrip: %s)", async (inStrip) => {
    const sent = vi.fn();
    server.use(...sendHandler((request) => { sent(request.text); return sendAnswer(request.id, "sent"); }));
    // A draft typed on the shell survives the launch, and startup changes the header rather than the field.
    const view = mount({ agent: shell, inStrip, agentLaunch: undefined });
    const box = screen.getByRole("textbox");
    expect(box).not.toBeDisabled();
    expect(box).toHaveAttribute("placeholder", "Type a shell command…");
    fireEvent.change(box, { target: { value: "draft survives startup" } });
    expect(startingTitle()).toBeNull();
    view.update({ agentLaunch: launch });
    expect(startingTitle()).toBeInTheDocument();
    expect(startingTitle()).toHaveTextContent("Starting…");
    expect(box).not.toBeDisabled();
    expect(box).not.toHaveAttribute("readonly");
    expect(box).not.toHaveAttribute("aria-disabled");
    expect(box).toHaveAttribute("placeholder", "Type a shell command…");
    expect(box).toHaveValue("draft survives startup");
    expect(screen.getAllByText("Starting…")).toHaveLength(1);
    expect(startingBeads()).toBe("var(--status-info)");
    expect(screen.getByRole("button", { name: /^Send$/ })).not.toHaveAttribute("aria-disabled");
    fireEvent.change(box, { target: { value: "draft survives startup!" } });
    expect(box).toHaveValue("draft survives startup!");
    // The multiplexer names the agent before the bridge has read it: Send still uses the Send Protocol.
    view.update({ agent: known });
    expect(screen.getByRole("button", { name: /^Send$/ })).not.toHaveAttribute("aria-disabled");
    expect(view.onReady).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await waitFor(() => expect(sent).toHaveBeenCalledExactlyOnceWith("draft survives startup!"));
    view.update({ text: READY, agent: { ...known, surface: FREE } });
    await waitFor(() => expect(view.onReady).toHaveBeenCalledOnce());
    expect(startingTitle()).toBeNull();
    expect(startingBeads()).toBe("");
    expect(box).not.toBeDisabled();
    expect(box).not.toHaveAttribute("readonly");
    expect(box).toHaveValue("");
    view.update({ agentLaunch: undefined });
    expect(sent).toHaveBeenCalledOnce();
  });

  it("keeps startup text sendable while the lifted dialog takes its own answers", async () => {
    const user = userEvent.setup();
    const view = mount({ agent: shell, agentLaunch: undefined });
    await user.type(screen.getByRole("textbox"), "kept");
    view.update({ agentLaunch: launch });
    expect(screen.getByRole("textbox")).not.toHaveAttribute("readonly");
    view.update({ text: TRUST, agent: { ...known, surface: ASK } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
    expect(view.onReady).not.toHaveBeenCalled();
    expect(startingTitle()).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("kept");
    expect(screen.getByRole("textbox")).not.toHaveAttribute("readonly");
  });

  it("does not open on a saved read, and does not unlock a pane whose sending is off", () => {
    const view = mount({ text: READY, agent: { ...known, surface: FREE }, stale: true });
    expect(startingTitle()).toBeInTheDocument();
    expect(view.onReady).not.toHaveBeenCalled();
    view.update({ stale: false, text: "$ kiro", agent: { ...known, sendProtocol: undefined } });
    expect(screen.getByRole("textbox")).toBeDisabled();
    // The header follows the launch, not the composer's lock: the agent is still starting.
    expect(startingTitle()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keys" })).not.toBeDisabled();
  });

  it.each([known, shell])("a pane opened without a launch keeps today's Send ($kind)", async (agent) => {
    const user = userEvent.setup();
    const sent = vi.fn();
    server.use(...sendHandler((request) => { sent(request.text); return sendAnswer(request.id, "sent"); }));
    mount({ agentLaunch: undefined, agent });
    await user.type(screen.getByRole("textbox"), "ordinary text");
    expect(screen.getByRole("textbox")).not.toBeDisabled();
    expect(screen.getByRole("textbox")).not.toHaveAttribute("placeholder", "Starting…");
    expect(startingTitle()).toBeNull();
    expect(startingBeads()).toBe("");
    await user.click(screen.getByRole("button", { name: /^Send$/ }));
    await waitFor(() => expect(sent).toHaveBeenCalledExactlyOnceWith("ordinary text"));
  });
});


it.each(["agent", "command"] as const)("switcher carries the launch row's %s metadata", async (kind) => {
  server.use(
    http.get("/api/launchers", () => HttpResponse.json({ home: "/home", launchers: [{ command: "kiro", label: "Launch Kiro", kind, harness: "kiro" }] })),
    http.post("/api/launch", () => HttpResponse.json({ ok: true, pane: { paneId: "new:p1", workspaceId: "new", workspaceLabel: "Kiro", tabId: "new:t1", cwd: "/home" } })),
  );
  const { router } = mount({ agentLaunch: undefined });
  await screen.findByRole("button", { name: "Actions" });
  act(() => {
    runShortcutAction("switch_pane");
  });
  await userEvent.click(await screen.findByText("Launch Kiro"));
  await waitFor(() => expect(router.state.location.pathname).toBe("/pane/new%3Ap1"));
  expect(readAgentLaunch(router.state.location.state, "new:p1")?.harness).toBe(kind === "agent" ? "kiro" : undefined);
});
