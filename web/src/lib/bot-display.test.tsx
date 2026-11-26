import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { vi } from "vitest";
import { server } from "@/test/msw";
import { fixtureAgents } from "@/test/handlers";
import { loadBotDisplays, useBotDisplays } from "./bot-display";
import { wipeDevice } from "./wipe";

const row = "\u0000\u0000w-test";
const other = "\u0000\u0000w-other";
const localCache = 'collie:bot-display:v1:["/","local"]';
const bot = { ...fixtureAgents[0]!, paneId: "w-test" };

afterEach(async () => {
  cleanup();
  await wipeDevice("unpair");
  document.querySelector('meta[name="collie-sso"]')?.remove();
});

function hold() {
  let release = () => {};
  const held = new Promise<void>(done => { release = done; });
  return { held, release };
}

it("paints a warm cache before GET and overlays a newer bot tap on the answer", async () => {
  localStorage.setItem(localCache, JSON.stringify({ views: [{ row, view: "terminal" }], pending: {} }));
  const get = hold();
  const puts: { row: string; view: string }[] = [];
  server.use(
    http.get("/api/bot-display", async () => {
      await get.held;
      return HttpResponse.json({ userId: "local", views: [{ row, view: "chat" }, { row: other, view: "terminal" }] });
    }),
    http.put("/api/bot-display", async ({ request }) => {
      // SAFETY: requestBotDisplays is the only writer in this isolated MSW world.
      const change = await request.json() as { row: string; view: "chat" | "terminal" };
      puts.push(change);
      return HttpResponse.json({ userId: "local", views: [change, { row: other, view: "terminal" }] });
    }),
  );
  const { result } = renderHook(useBotDisplays);
  expect(result.current.views.get(row)).toBe("terminal");
  act(() => result.current.setView(bot, "chat"));
  get.release();
  await waitFor(() => expect(puts).toEqual([{ row, view: "chat" }]));
  await waitFor(() => expect(result.current.views.get(other)).toBe("terminal"));
  expect(JSON.parse(localStorage.getItem(localCache)!)).toEqual({ views: [{ row, view: "chat" }, { row: other, view: "terminal" }], pending: {} });
});

it("persists the explicit Messages choice when no row exists yet", async () => {
  const write = vi.fn();
  server.use(
    http.get("/api/bot-display", () => HttpResponse.json({ userId: "local", views: [] })),
    http.put("/api/bot-display", async ({ request }) => {
      write(await request.json());
      return HttpResponse.json({ userId: "local", views: [{ row, view: "chat" }] });
    }),
  );
  await loadBotDisplays();
  const page = renderHook(useBotDisplays);
  expect(page.result.current.views.has(row)).toBe(false);
  act(() => page.result.current.setView(bot, "chat"));
  await waitFor(() => expect(write).toHaveBeenCalledWith({ row, view: "chat" }));
});

it("holds a failed write until the next online retry instead of spinning", async () => {
  const write = vi.fn();
  server.use(
    http.get("/api/bot-display", () => HttpResponse.json({ userId: "local", views: [] })),
    http.put("/api/bot-display", async ({ request }) => {
      write(await request.json());
      return HttpResponse.text("unavailable", { status: 503 });
    }),
  );
  await loadBotDisplays();
  const page = renderHook(useBotDisplays);
  act(() => page.result.current.setView(bot, "terminal"));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  await new Promise(resolve => setTimeout(resolve, 350));
  expect(write).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("online"));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
});

it("replays a pending write after reload and drops a corrupt cache", async () => {
  localStorage.setItem(localCache, JSON.stringify({ views: [], pending: { [row]: "terminal" } }));
  const write = vi.fn();
  server.use(http.put("/api/bot-display", async ({ request }) => {
    write(await request.json());
    return HttpResponse.json({ userId: "local", views: [{ row, view: "terminal" }] });
  }));
  await loadBotDisplays();
  await waitFor(() => expect(write).toHaveBeenCalledWith({ row, view: "terminal" }));
  await wipeDevice("unpair");

  localStorage.setItem(localCache, "{");
  const page = renderHook(useBotDisplays);
  expect(page.result.current.views.size).toBe(0);
  expect(localStorage.getItem(localCache)).toBe("{");
});

it("reads and patches only the signed-in account's bot rows", async () => {
  const meta = document.createElement("meta");
  meta.name = "collie-sso";
  meta.content = JSON.stringify({ sub: "person", role: "member" });
  document.head.appendChild(meta);
  const patch = vi.fn();
  server.use(
    http.get("/api/user-settings", ({ request }) => {
      expect(request.headers.get("X-Collie-Subject")).toBe("person");
      return HttpResponse.json({ ["bot-display:v1:" + row]: "terminal", theme: "dark" });
    }),
    http.patch("/api/user-settings", async ({ request }) => {
      patch(request.headers.get("X-Collie-Role"), await request.json());
      return HttpResponse.json({ ["bot-display:v1:" + row]: "chat" });
    }),
  );
  await loadBotDisplays();
  const page = renderHook(useBotDisplays);
  expect(page.result.current.views.get(row)).toBe("terminal");
  act(() => page.result.current.setView(bot, "chat"));
  await waitFor(() => expect(patch).toHaveBeenCalledWith("member", { set: { ["bot-display:v1:" + row]: "chat" }, remove: [] }));
});
