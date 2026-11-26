import { render } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, it, vi } from "vitest";
import { fixtureAgents, fixtureWorkspaces } from "@/test/handlers";
import { server } from "@/test/msw";
import type { AgentView } from "@/lib/types";
import { BotChatBar } from "./bot-chat-bar";
import { MobileAgentHub } from "./mobile-agent-hub";

const original: AgentView = { ...fixtureAgents[0]!, paneLabel: "Design", subtitle: "Latest message",
  lastActiveAt: 150, lastSeenAt: 100 };
const list = { writable: false, listScope: {}, scopeOf: () => ({}), onOpen: vi.fn(), onPress: vi.fn(),
  workspaces: fixtureWorkspaces, onChanged: vi.fn() };
const bar = { bot: { name: "Design", color: 1, silhouette: 2 }, unread: 0, pinned: false, back: vi.fn(),
  pin: vi.fn(), terminal: false };

it("updates the same row and header when a snapshot changes and restores the preview once seen", () => {
  server.use(http.get("/api/chat-order", () => HttpResponse.json([])));
  function view(pane: AgentView) {
    return <><MobileAgentHub {...list} panes={[pane]} /><BotChatBar {...bar} pane={pane} /></>;
  }
  const page = render(view(original));
  const row = page.container.querySelector(".bot-row")!;
  const pill = page.container.querySelector(".bot-pill")!;
  const avatar = ".bot-activity-avatar";
  for (const [change, state, preview] of [
    [{ status: "working" }, "working", "Working…"],
    [{ status: "blocked" }, "blocked", "Needs you"],
    [{ status: "blocked", blockedBy: "error" }, "error", "Stopped"],
    [{ status: "done" }, "done", "Ready"],
    [{ status: "done", lastSeenAt: 151 }, "idle", "Latest message"],
    [{ status: "unknown" }, "idle", "Latest message"],
  ] as const) {
    page.rerender(view({ ...original, ...change }));
    expect(row.querySelector(avatar)).toHaveAttribute("data-activity", state);
    expect(pill.querySelector(avatar)).toHaveAttribute("data-activity", state);
    expect(row.querySelector(".bot-line")).toHaveTextContent(preview);
    expect(pill.querySelector('[role="status"]')!.textContent).toBe(state === "idle" ? "" : preview);
  }
});
