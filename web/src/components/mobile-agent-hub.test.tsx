import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw";
import { wipeDevice } from "@/lib/wipe";
import { vi } from "vitest";
import { fixtureAgents, fixtureShellPanes, fixtureWorkspaces } from "@/test/handlers";
import { MobileAgentHub } from "./mobile-agent-hub";

const props = {
  panes: [...fixtureAgents, ...fixtureShellPanes], workspaces: fixtureWorkspaces,
  writable: true, listScope: {}, onChanged: vi.fn(),
  scopeOf: () => ({}), onOpen: vi.fn(), onPress: vi.fn(),
};
beforeEach(() => server.use(http.get("/api/chat-order", () => HttpResponse.json([]))));
afterEach(async () => { cleanup(); await wipeDevice("unpair"); });

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
