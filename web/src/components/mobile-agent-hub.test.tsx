import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw";
import { wipeDevice } from "@/lib/wipe";
import { vi } from "vitest";
import { fixtureAgents, fixtureShellPanes, fixtureWorkspaces } from "@/test/handlers";
import { MobileAgentHub } from "./mobile-agent-hub";
import { setLocale } from "@/lib/i18n";

const props = {
  panes: [...fixtureAgents, ...fixtureShellPanes], workspaces: fixtureWorkspaces,
  writable: true, listScope: {}, onChanged: vi.fn(),
  scopeOf: () => ({}), onOpen: vi.fn(), onPress: vi.fn(),
};
beforeEach(() => server.use(http.get("/api/chat-order", () => HttpResponse.json([]))));
afterEach(async () => { cleanup(); await wipeDevice("unpair"); });

it("shows minutes for chats and workspaces, then pending cleanup once the deadline passes", () => {
  setLocale("en");
  const now = Date.now();
  const pane = fixtureAgents[0]!;
  const panes = [
    { ...pane, paneId: "trash-chat", terminalId: "trash-chat", trash: { trashedAt: now - 2 * 60_000, originalWorkspaceId: pane.workspaceId } },
    { ...pane, paneId: "trash-space", terminalId: "trash-space", trash: { trashedAt: now - 9 * 60_000, originalWorkspaceId: "removed-space", workspaceLabel: "Removed workspace" } },
    { ...pane, paneId: "trash-expired", terminalId: "trash-expired", trash: { trashedAt: now - 15 * 60_000, originalWorkspaceId: pane.workspaceId } },
  ];
  render(<MobileAgentHub {...props} panes={panes} />);
  expect(screen.getByText("Deletes in 13 min")).toBeInTheDocument();
  expect(screen.getByText(/Deletes in 6 min/)).toBeInTheDocument();
  expect(screen.getByText("Pending deletion")).toBeInTheDocument();
});

it("folds one workspace and searches across folded sections", () => {
  const { container, unmount } = render(<MobileAgentHub {...props} />);
  expect(container.querySelectorAll("li")).toHaveLength(3);
  fireEvent.click(screen.getByText("webapp", { selector: ".bot-group" }));
  expect(container.querySelectorAll("li")).toHaveLength(2);
  const cacheKey = 'collie:bot-sections:v1:["/","local"]';
  const closed = localStorage.getItem(cacheKey);
  expect(closed).not.toBeNull();
  fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "webapp" } });
  expect(container.querySelectorAll("li")).toHaveLength(1);
  const row = container.querySelector("li button")!;
  fireEvent.pointerDown(row, { button: 0, isPrimary: true });
  fireEvent.click(row);
  expect(props.onPress).toHaveBeenCalledWith(fixtureAgents[0]);
  expect(props.onOpen).toHaveBeenCalledWith(fixtureAgents[0]);
  expect(localStorage.getItem(cacheKey)).toBe(closed);
  unmount();
  const again = render(<MobileAgentHub {...props} />);
  expect(screen.getByText("webapp", { selector: ".bot-group" })).toHaveAttribute("aria-expanded", "false");
  expect(again.container.querySelectorAll("li")).toHaveLength(2);
});

it("keeps the trash folded after remount and keeps a renamed or reordered workspace folded", () => {
  const trash = { ...fixtureAgents[0]!, paneId: "fixture-trash",
    trash: { trashedAt: Date.now(), originalWorkspaceId: fixtureAgents[0]!.workspaceId } };
  const panes = [...props.panes, trash];
  const first = render(<MobileAgentHub {...props} panes={panes} />);
  for (const name of ["webapp", "Papelera"]) fireEvent.click(screen.getByText(name, { selector: ".bot-group" }));
  first.unmount();
  const workspaces = props.workspaces.toReversed().map(item =>
    item.label === "webapp" ? Object.assign({}, item, { label: "renamed" }) : item);
  render(<MobileAgentHub {...props} panes={panes} workspaces={workspaces} />);
  for (const name of ["renamed", "Papelera"]) {
    expect(screen.getByText(name, { selector: ".bot-group" })).toHaveAttribute("aria-expanded", "false");
  }
});


it("keeps workspace positions while chats inside each workspace follow new activity", async () => {
  const base = fixtureAgents[0]!;
  const panes = [
    { ...base, paneId: "older", terminalId: "older", paneLabel: "Older bot", lastActiveAt: 100, lastSeenAt: 900 },
    { ...base, paneId: "newer", terminalId: "newer", paneLabel: "Newer bot", lastActiveAt: 200 },
    { ...base, paneId: "newest", terminalId: "newest", paneLabel: "Newest bot", workspaceId: "recent", workspaceLabel: "Recent workspace", lastActiveAt: 300 },
  ];
  const orderRead = vi.fn(() => HttpResponse.json([{ workspaceId: base.workspaceId, paneIds: ["older", "newer"] }]));
  server.use(http.get("/api/chat-order", orderRead));
  const workspaces = [fixtureWorkspaces[0]!, { ...fixtureWorkspaces[0]!, workspaceId: "recent", label: "Recent workspace" }];
  const page = render(<MobileAgentHub {...props} panes={panes} workspaces={workspaces} />);
  const names = () => [...page.container.querySelectorAll(".bot-row strong")].map(el => el.textContent);
  await waitFor(() => expect(orderRead).toHaveBeenCalled());
  expect(names()).toEqual(["Newer bot", "Older bot", "Newest bot"]);
  expect(page.container.querySelector(".bot-group")).toHaveTextContent("webapp");
  const updated = panes.map(p => p.paneId === "older" ? { ...p, lastActiveAt: 400 } : p);
  page.rerender(<MobileAgentHub {...props} panes={updated} workspaces={workspaces} />);
  expect(names()).toEqual(["Older bot", "Newer bot", "Newest bot"]);
  expect(panes.map(p => p.paneId)).toEqual(["older", "newer", "newest"]);
  fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "bot" } });
  expect(names()).toEqual(["Older bot", "Newer bot", "Newest bot"]);
});
