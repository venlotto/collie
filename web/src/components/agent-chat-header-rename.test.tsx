import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { fixtureAgents, paneTextWithDraft } from "@/test/handlers";
import type { AgentView } from "@/lib/types";
import { withHeaderHost } from "@/test/header-host";
import { CROSSFADE_QUIET_MS } from "@/components/ui/crossfade-text";
import { AgentChat } from "./agent-chat";

afterEach(cleanup);

describe("AgentChat header — a rename fades", () => {
  function Renamable({ first, second }: { first: AgentView; second: AgentView }) {
    const [agent, setAgent] = useState(first);
    return (
      <>
        <button type="button" onClick={() => setAgent(second)}>
          rename-test
        </button>
        <AgentChat
          paneId={agent.paneId}
          agent={agent}
          agents={[agent]}
          shellPanes={[]}
          tabs={[]}
          text={paneTextWithDraft("recent pane output")}
          onBack={vi.fn()}
          onSelect={vi.fn()}
        />
      </>
    );
  }
  const out = (c: HTMLElement, slot: string) => c.querySelector(`[data-slot="${slot}"] [data-slot="crossfade-out"]`);

  // A name fades only after it held still for the quiet time (ui/crossfade-text.tsx): move the clock on.
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  function mount(first: AgentView, second: AgentView) {
    const router = createMemoryRouter([{ path: "/", element: withHeaderHost(<Renamable first={first} second={second} />) }]);
    return render(<RouterProvider router={router} />).container;
  }

  it("fades the pane's name and its Space when the same pane is renamed", () => {
    const base = fixtureAgents[0]!;
    const container = mount(
      { ...base, paneLabel: "plumbing", workspaceLabel: "webapp" },
      { ...base, paneLabel: "wiring", workspaceLabel: "frontend" },
    );
    expect(out(container, "pane-name")).toBeNull();
    vi.setSystemTime(Date.now() + CROSSFADE_QUIET_MS);
    fireEvent.click(screen.getByRole("button", { name: "rename-test" }));
    expect(out(container, "pane-name")).toHaveTextContent("plumbing");
    expect(out(container, "pane-name")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector('[data-slot="pane-name"]')).toHaveTextContent("wiring");
    expect(out(container, "pane-place")).toHaveTextContent("webapp");
  });

  it("swaps at once when the header shows another pane", () => {
    const base = fixtureAgents[0]!;
    const container = mount({ ...base, paneLabel: "plumbing" }, { ...base, paneId: "w9:p9", paneLabel: "wiring" });
    fireEvent.click(screen.getByRole("button", { name: "rename-test" }));
    expect(container.querySelector('[data-slot="pane-name"]')).toHaveTextContent("wiring");
    expect(container.querySelector('[data-slot="crossfade-out"]')).toBeNull();
  });
});
