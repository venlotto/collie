import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { ROOT_ROUTE_ID, rootLoader, type HomeData } from "@/lib/loaders";
import { paneRowKey } from "@/lib/hosts";
import { panePlaceParts } from "@/lib/pane-name";
import type { AgentView } from "@/lib/types";
import { fixtureAgents, fixtureSnapshot } from "@/test/handlers";
import { server } from "@/test/msw";
import { wipeDevice } from "@/lib/wipe";
import { HomeRoute } from "./home";

const data: HomeData = {
  ...fixtureSnapshot, bridge: "connected", device: undefined, scope: {}, viewAll: false,
  sessions: fixtureSnapshot.sessions ?? [], servers: fixtureSnapshot.servers ?? [],
  snoozedUntil: null, update: undefined, error: false, authError: false,
};
const pinOf = (pane: AgentView, at: number) => ({ row: paneRowKey(pane), space: panePlaceParts(pane).space, at });

function renderHome() {
  const router = createMemoryRouter([
    { id: ROOT_ROUTE_ID, path: "/", loader: rootLoader, element: <HomeRoute /> },
    { path: "/pane/:paneId", element: <div /> },
  ]);
  render(<RouterProvider router={router} />);
}

afterEach(async () => {
  cleanup();
  await wipeDevice("unpair");
});

describe("HomeRoute's featured slot", () => {
  it("uses only the server pin, replaces it on refresh, and never falls back to focus", async () => {
    let featured: ReturnType<typeof pinOf> | null = null;
    server.use(
      http.get("/api/bot-featured", () => HttpResponse.json({ userId: "local", featured })),
      http.get("/api/snapshot", () => HttpResponse.json(data)),
    );
    renderHome();
    await screen.findByRole("button", { name: "webapp" });
    await waitFor(() => expect(document.querySelector(".bot-featured")).toBeNull(), { timeout: 10_000 });
    expect(fixtureAgents[1]!.focused).toBe(true);

    featured = pinOf(fixtureAgents[0]!, 1);
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(document.querySelector(".bot-featured")).toHaveTextContent("claude"));

    featured = pinOf(fixtureAgents[1]!, 2);
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(document.querySelector(".bot-featured")).toHaveTextContent("codex"), { timeout: 10_000 });

    featured = null;
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(document.querySelector(".bot-featured")).toBeNull(), { timeout: 10_000 });
  });
});
