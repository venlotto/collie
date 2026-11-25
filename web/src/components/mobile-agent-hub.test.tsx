import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";

import { fixtureAgents, fixtureShellPanes, fixtureWorkspaces } from "@/test/handlers";
import { MobileAgentHub } from "./mobile-agent-hub";

describe("MobileAgentHub", () => {
  it("starts as a chat-first index with large workspace choices", () => {
    const { container } = render(
      <MobileAgentHub
        panes={[...fixtureAgents, ...fixtureShellPanes]}
        workspaces={fixtureWorkspaces}
        onOpen={() => {}}
        onPress={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "Conversations" })).toBeInTheDocument();
    expect(container.querySelector('[data-slot="mobile-workspaces"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="mobile-workspaces"] button')).toHaveLength(3);
    expect(container.querySelectorAll("li")).toHaveLength(3);
  });

  it("filters the chat rows directly from a workspace card and search", () => {
    const { container } = render(
      <MobileAgentHub
        panes={[...fixtureAgents, ...fixtureShellPanes]}
        workspaces={fixtureWorkspaces}
        onOpen={() => {}}
        onPress={() => {}}
      />,
    );

    const workspaces = container.querySelector<HTMLElement>('[data-slot="mobile-workspaces"]')!;
    fireEvent.click(within(workspaces).getByRole("button", { name: /webapp/i }));
    expect(container.querySelectorAll("li")).toHaveLength(1);

    fireEvent.click(within(workspaces).getByRole("button", { name: /all spaces/i }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "codex" } });
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.querySelector("li")).toHaveTextContent("codex");
  });

  it("prefetches on press and opens the tapped conversation", () => {
    const onPress = vi.fn();
    const onOpen = vi.fn();
    const { container } = render(
      <MobileAgentHub panes={fixtureAgents} workspaces={fixtureWorkspaces} onOpen={onOpen} onPress={onPress} />,
    );
    const row = container.querySelector<HTMLButtonElement>("li button")!;

    fireEvent.pointerDown(row);
    fireEvent.click(row);

    expect(onPress).toHaveBeenCalledWith(fixtureAgents[0]);
    expect(onOpen).toHaveBeenCalledWith(fixtureAgents[0], row);
  });
});
