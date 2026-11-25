import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { fixtureAgents, fixtureShellPanes, fixtureWorkspaces } from "@/test/handlers";
import { MobileAgentHub } from "./mobile-agent-hub";

const props = {
  panes: [...fixtureAgents, ...fixtureShellPanes], workspaces: fixtureWorkspaces,
  writable: true, listScope: {}, onChanged: vi.fn(),
  scopeOf: () => ({}), onOpen: vi.fn(), onPress: vi.fn(),
};
it("folds one workspace and searches across folded sections", () => {
  const { container } = render(<MobileAgentHub {...props} />);
  expect(container.querySelectorAll("li")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "webapp" }));
  expect(container.querySelectorAll("li")).toHaveLength(2);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "webapp" } });
  expect(container.querySelectorAll("li")).toHaveLength(1);
  const row = container.querySelector("li button")!;
  fireEvent.pointerDown(row, { button: 0, isPrimary: true });
  fireEvent.click(row);
  expect(props.onPress).toHaveBeenCalledWith(fixtureAgents[0]);
  expect(props.onOpen).toHaveBeenCalledWith(fixtureAgents[0]);
});
