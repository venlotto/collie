import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { http, HttpResponse } from "msw";
import { expect, it, vi } from "vitest";
import { server } from "@/test/msw";
import { fixtureAgents } from "@/test/handlers";
import type { ComponentProps } from "react";
import type { Composer } from "./composer";
type ComposerProps = ComponentProps<typeof Composer>;
import { AgentRunChat } from "./agent-run-chat";

vi.mock("@/hooks/use-chat-window", () => ({ useChatWindow: () => ({}) }));
vi.mock("./session-stream", () => ({ SessionStream: () => null }));
vi.mock("./composer", () => ({ Composer: ({ sendAction }: ComposerProps) =>
  <button disabled={sendAction?.busy} onClick={() => void sendAction?.onSelect("Revisa los pendientes")}>
    {sendAction?.label}
  </button> }));

const run = { id: "20261128T120000-old-abcd", status: "done", start: 1, end: 2, canResume: false } as const;

function open(readOnly = false, stale = false) {
  const agent = { ...fixtureAgents[0]!, paneId: "agent-run:" + run.id, workspaceId: "w7", agentRun: run };
  const router = createMemoryRouter([
    { path: "/pane/:id", element: <AgentRunChat agent={agent} run={run} scope={{}} active writable={!readOnly} readOnly={readOnly} stale={stale} /> },
  ], { initialEntries: ["/pane/" + encodeURIComponent(agent.paneId)] });
  render(<RouterProvider router={router} />);
  return router;
}

it("opens the created bot directly and sends the source workspace and draft", async () => {
  const bodies: unknown[] = [];
  server.use(http.post("/api/pane/:id/new-chat", async ({ request }) => {
    bodies.push(await request.json());
    return HttpResponse.json({ ok: true, paneId: "w7:p9", runId: null });
  }));
  const router = open();
  fireEvent.click(screen.getByRole("button", { name: "Open new chat" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/pane/w7%3Ap9"));
  expect(bodies).toEqual([{ text: "Revisa los pendientes", workspaceId: "w7", requestId: expect.any(String) }]);
});

it("keeps the old chat on failure and retries with the same creation id", async () => {
  const bodies: unknown[] = [];
  server.use(http.post("/api/pane/:id/new-chat", async ({ request }) => {
    bodies.push(await request.json());
    return new HttpResponse("unavailable", { status: 502 });
  }));
  const router = open();
  const oldPath = router.state.location.pathname;
  fireEvent.click(screen.getByRole("button", { name: "Open new chat" }));
  await screen.findByRole("alert");
  expect(router.state.location.pathname).toBe(oldPath);
  fireEvent.click(screen.getByRole("button", { name: "Open new chat" }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[0]).toEqual(bodies[1]);
});

it.each([[true, false], [false, true]])("does not create from a read-only or stale view (%s, %s)", async (readOnly, stale) => {
  const request = vi.fn();
  server.use(http.post("/api/pane/:id/new-chat", request));
  const router = open(readOnly, stale);
  const oldPath = router.state.location.pathname;
  fireEvent.click(screen.getByRole("button", { name: "Open new chat" }));
  expect(router.state.location.pathname).toBe(oldPath);
  expect(request).not.toHaveBeenCalled();
});
