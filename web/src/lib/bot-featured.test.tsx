import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { vi } from "vitest";
import { fixtureAgents } from "@/test/handlers";
import { server } from "@/test/msw";
import { paneRowKey } from "./hosts";
import { panePlaceParts } from "./pane-name";
import type { AgentView } from "./types";
import { BotFeaturedStore, featuredBotPane, loadBotFeatured, useBotFeatured } from "./bot-featured";
import type { BotFeaturedPin } from "./bot-featured-wire";
import { wipeDevice } from "./wipe";

const A = fixtureAgents[0]!;
const B = fixtureAgents[1]!;
const localCache = 'collie:bot-featured:v1:["/","local"]';
const pinOf = (pane: AgentView, at = 1): BotFeaturedPin => ({ row: paneRowKey(pane), space: panePlaceParts(pane).space, at });

function hold() {
  let release = () => {};
  const held = new Promise<void>(done => { release = done; });
  return { held, release };
}

afterEach(async () => {
  cleanup();
  await wipeDevice("unpair");
  document.querySelector('meta[name="collie-sso"]')?.remove();
  vi.restoreAllMocks();
});

it("has no focused or first-row fallback, replaces A with B, and unpins only its current owner", () => {
  const store = new BotFeaturedStore({ userId: "local" });
  try {
    expect(featuredBotPane(fixtureAgents, store.read())).toBeUndefined();
    store.setPane(A, true, 1);
    expect(featuredBotPane(fixtureAgents, store.read())).toBe(A);
    store.setPane(B, true, 2);
    expect(featuredBotPane(fixtureAgents, store.read())).toBe(B);
    store.setPane(A, false);
    expect(featuredBotPane(fixtureAgents, store.read())).toBe(B);
    store.clearPane(B);
    expect(store.read()).toBeNull();
    expect(featuredBotPane(fixtureAgents, store.read())).toBeUndefined();
  } finally { store.dispose(); }
});

it("does not inherit a reused id in another workspace and hides a trashed owner", () => {
  const pin = pinOf(A);
  expect(featuredBotPane([{ ...A, workspaceId: "other", workspaceLabel: "Other" }], pin)).toBeUndefined();
  expect(featuredBotPane([{ ...A, trash: { trashedAt: 1, originalWorkspaceId: A.workspaceId } }], pin)).toBeUndefined();
  expect(featuredBotPane([A], pin)).toBe(A);
});

it("paints its synchronous cache first, then accepts the authoritative server replacement", async () => {
  localStorage.setItem(localCache, JSON.stringify({ featured: pinOf(A) }));
  const get = hold();
  server.use(http.get("/api/bot-featured", async () => {
    await get.held;
    return HttpResponse.json({ userId: "local", featured: pinOf(B, 2) });
  }));
  const page = renderHook(useBotFeatured);
  expect(page.result.current.featured).toEqual(pinOf(A));
  get.release();
  await waitFor(() => expect(page.result.current.featured).toEqual(pinOf(B, 2)));
  expect(JSON.parse(localStorage.getItem(localCache)!)).toEqual({ featured: pinOf(B, 2) });
});

it("serialises replacement writes and keeps the newest pending choice", async () => {
  const first = hold();
  const puts: (BotFeaturedPin | null)[] = [];
  server.use(http.put<never, { featured: BotFeaturedPin | null }>("/api/bot-featured", async ({ request }) => {
    const { featured } = await request.json();
    puts.push(featured);
    if (puts.length === 1) await first.held;
    return HttpResponse.json({ userId: "local", featured });
  }));
  const page = renderHook(useBotFeatured);
  act(() => page.result.current.setFeatured(A, true, 1));
  await waitFor(() => expect(puts).toHaveLength(1));
  act(() => page.result.current.setFeatured(B, true, 2));
  first.release();
  await waitFor(() => expect(puts).toEqual([pinOf(A), pinOf(B, 2)]));
  await waitFor(() => expect(JSON.parse(localStorage.getItem(localCache)!)).toEqual({ featured: pinOf(B, 2) }));
  expect(page.result.current.featured).toEqual(pinOf(B, 2));
});

it("waits for the server on an online boot and uses disk at once offline", async () => {
  localStorage.setItem(localCache, JSON.stringify({ featured: pinOf(A) }));
  const get = hold();
  server.use(http.get("/api/bot-featured", async () => {
    await get.held;
    return HttpResponse.json({ userId: "local", featured: pinOf(B, 2) });
  }));
  let ready = false;
  const loading = (async () => { await loadBotFeatured(); ready = true; })();
  await act(async () => {});
  expect(ready).toBe(false);
  get.release();
  await loading;
  expect(ready).toBe(true);

  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await wipeDevice("unpair");
  localStorage.setItem(localCache, JSON.stringify({ featured: pinOf(A) }));
  await loadBotFeatured();
  const page = renderHook(useBotFeatured);
  expect(page.result.current.featured).toEqual(pinOf(A));
  online.mockReturnValue(true);
  act(() => { window.dispatchEvent(new Event("online")); });
  await waitFor(() => expect(page.result.current.featured).toEqual(pinOf(B, 2)));
});

it("opens empty on a corrupt cache and a late response cannot recreate a wiped key", async () => {
  localStorage.setItem(localCache, "{");
  const get = hold();
  server.use(http.get("/api/bot-featured", async () => {
    await get.held;
    return HttpResponse.json({ userId: "local", featured: pinOf(A) });
  }));
  const page = renderHook(useBotFeatured);
  expect(page.result.current.featured).toBeNull();
  page.unmount();
  await wipeDevice("unpair");
  get.release();
  await act(async () => {});
  expect(localStorage.getItem(localCache)).toBeNull();
});

it("reads and patches only the signed-in subject's setting", async () => {
  localStorage.setItem(localCache, JSON.stringify({ featured: pinOf(A) }));
  const meta = document.createElement("meta");
  meta.name = "collie-sso";
  meta.content = JSON.stringify({ sub: "local", role: "member" });
  document.head.appendChild(meta);
  const patch = vi.fn();
  server.use(
    http.get("/api/user-settings", ({ request }) => {
      expect(request.headers.get("X-Collie-Subject")).toBe("local");
      return HttpResponse.json({ "bot-featured:v1": JSON.stringify(pinOf(B, 2)), theme: "dark" });
    }),
    http.patch("/api/user-settings", async ({ request }) => {
      patch(request.headers.get("X-Collie-Role"), await request.json());
      return HttpResponse.json({ theme: "dark" });
    }),
  );
  await loadBotFeatured();
  const page = renderHook(useBotFeatured);
  expect(page.result.current.featured).toEqual(pinOf(B, 2));
  act(() => page.result.current.setFeatured(B, false));
  await waitFor(() => expect(patch).toHaveBeenCalledWith("member", { set: {}, remove: ["bot-featured:v1"] }));
  expect(JSON.parse(localStorage.getItem(localCache)!)).toEqual({ featured: pinOf(A) });
  expect(localStorage.getItem('collie:bot-featured:v1:["/","sso:local"]')).not.toBeNull();
});

it("forgets the in-memory pin and every account cache on unpair", async () => {
  const page = renderHook(useBotFeatured);
  act(() => page.result.current.setFeatured(A, true));
  expect(page.result.current.featured).toEqual(pinOf(A, page.result.current.featured!.at));
  expect(localStorage.getItem(localCache)).not.toBeNull();
  page.unmount(); // Ending a pairing replaces the app with its pair screen.
  await act(() => wipeDevice("unpair"));
  const reopened = renderHook(useBotFeatured);
  expect(reopened.result.current.featured).toBeNull();
  expect(localStorage.getItem(localCache)).toBeNull();
});
