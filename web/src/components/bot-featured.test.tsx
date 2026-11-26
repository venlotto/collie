import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureAgents, fixtureWorkspaces } from "@/test/handlers";
import { server } from "@/test/msw";
import { BotChatBar } from "./bot-chat-bar";
import { MobileAgentHub } from "./mobile-agent-hub";

const A = fixtureAgents[0]!;
const B = fixtureAgents[1]!;
const list = { writable: false, listScope: {}, scopeOf: () => ({}), onOpen: vi.fn(), onPress: vi.fn(),
  workspaces: fixtureWorkspaces, onChanged: vi.fn() };

beforeEach(() => server.use(http.get("/api/chat-order", () => HttpResponse.json([]))));
afterEach(cleanup);

describe("the single slot in the Grok list", () => {
  it("renders no slot without a pin, shows A, replaces it with B, and removes it on unpin", async () => {
    const page = render(<MobileAgentHub {...list} panes={fixtureAgents} />);
    expect(page.container.querySelector(".bot-featured")).toBeNull();
    expect(screen.getByRole("button", { name: "Crear nuevo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "webapp" })).toBeInTheDocument();

    page.rerender(<MobileAgentHub {...list} panes={fixtureAgents} featured={A} />);
    expect(page.container.querySelector(".bot-featured")).toHaveTextContent("claude");
    expect(page.container.querySelectorAll(".bot-row")).toHaveLength(2);

    page.rerender(<MobileAgentHub {...list} panes={fixtureAgents} featured={B} />);
    expect(page.container.querySelector(".bot-featured")).toHaveTextContent("codex");
    expect(page.container.querySelector(".bot-featured")).not.toHaveTextContent("claude");
    expect(page.container.querySelectorAll(".bot-row")).toHaveLength(2);

    await userEvent.click(page.container.querySelector(".bot-featured")!);
    expect(list.onOpen).toHaveBeenCalledWith(B);
    page.rerender(<MobileAgentHub {...list} panes={fixtureAgents} />);
    expect(page.container.querySelector(".bot-featured")).toBeNull();
    expect(page.container.querySelectorAll(".bot-row")).toHaveLength(2);
  });

  it("keeps the slot out of search results", async () => {
    const page = render(<MobileAgentHub {...list} panes={fixtureAgents} featured={A} />);
    expect(page.container.querySelector(".bot-featured")).not.toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar" }), { target: { value: "claude" } });
    expect(page.container.querySelector(".bot-featured")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar" }), { target: { value: "" } });
    expect(page.container.querySelector(".bot-featured")).not.toBeNull();
  });
});

describe("the Grok chat pin action", () => {
  const bot = { name: "Design", color: 1, silhouette: 2 };
  it("offers Pin when absent and Unpin for the current owner", async () => {
    const pin = vi.fn();
    const page = render(<BotChatBar bot={bot} pane={A} unread={0} pinned={false} back={vi.fn()} pin={pin} terminal={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Opciones del chat" }));
    await userEvent.click(screen.getByText("Fijar chat"));
    expect(pin).toHaveBeenCalledTimes(1);

    page.rerender(<BotChatBar bot={bot} pane={A} unread={0} pinned back={vi.fn()} pin={pin} terminal={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Opciones del chat" }));
    expect(screen.getByText("Desfijar chat")).toBeInTheDocument();
  });
});
