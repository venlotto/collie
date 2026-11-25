import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceList, WorkspaceNewSpaceButton } from "./workspace-list";
import type { AgentView, WorkspaceView } from "@/lib/types";

const workspaces: WorkspaceView[] = [
  { workspaceId: "w1", number: 1, label: "alpha", focused: false, activeTabId: "w1:t1", tabCount: 1, paneCount: 1 },
  { workspaceId: "w2", number: 2, label: "beta", focused: false, activeTabId: "w2:t1", tabCount: 1, paneCount: 2 },
];

const agents: AgentView[] = [
  {
    paneId: "w2:p1",
    workspaceId: "w2",
    workspaceLabel: "beta",
    workspaceNumber: 2,
    tabId: "w2:t1",
    agent: "codex",
    status: "blocked",
    cwd: "/work/beta",
    focused: false,
  },
];

describe("WorkspaceList", () => {
  it("reports search and navigation to the embedding surface", async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    const onOpen = vi.fn();
    render(
      <WorkspaceList
        workspaces={workspaces}
        agents={agents}
        query=""
        onQueryChange={onQueryChange}
        onOpen={onOpen}
      />,
    );

    await user.type(screen.getByRole("searchbox", { name: /filter spaces/i }), "be");
    expect(onQueryChange).toHaveBeenCalledWith("b");
    expect(onQueryChange).toHaveBeenLastCalledWith("e");

    await user.click(screen.getByRole("button", { name: /beta/ }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("w2");
  });

  it("keeps status, counts and the creation note in the reusable body", () => {
    render(
      <WorkspaceList
        workspaces={workspaces}
        agents={agents}
        query=""
        onQueryChange={vi.fn()}
        onOpen={vi.fn()}
        createNote="This multiplexer cannot create a space."
      />,
    );

    expect(screen.getByText("This multiplexer cannot create a space.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /needs you.*beta/i })).toBeInTheDocument();
    expect(screen.getByLabelText("2 panes")).toBeInTheDocument();
  });
});

describe("WorkspaceNewSpaceButton", () => {
  it("exposes the shared create-space action", async () => {
    const user = userEvent.setup();
    const onNewSpace = vi.fn();
    render(<WorkspaceNewSpaceButton onNewSpace={onNewSpace} />);
    await user.click(screen.getByRole("button", { name: /new space/i }));
    expect(onNewSpace).toHaveBeenCalledOnce();
  });
});
