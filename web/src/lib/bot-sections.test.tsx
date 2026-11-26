import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { vi } from "vitest";
import { server } from "@/test/msw";
import { wipeDevice } from "./wipe";
import { loadBotSections, useBotSections } from "./bot-sections";

const team = JSON.stringify([null, null, "w-test"]);
const localCache = 'collie:bot-sections:v1:["/","local"]';

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

it("paints a warm cache before GET and overlays only newer taps on the server response", async () => {
  localStorage.setItem(localCache, JSON.stringify({ folded: ["stale"], pending: {} }));
  const get = hold();
  const puts: Record<string, boolean>[] = [];
  server.use(
    http.get("/api/ui-sections", async () => {
      await get.held;
      return HttpResponse.json({ userId: "local", folded: ["trash"] });
    }),
    http.put<never, { changes: Record<string, boolean> }>("/api/ui-sections", async ({ request }) => {
      const { changes } = await request.json();
      puts.push(changes);
      return HttpResponse.json({ userId: "local", folded: ["trash", team] });
    }),
  );
  const { result } = renderHook(useBotSections);
  expect([...result.current.folded]).toEqual(["stale"]);
  act(() => {
    result.current.toggle(team);
    result.current.toggle(team);
    result.current.toggle(team);
  });
  get.release();
  await waitFor(() => expect(puts).toEqual([{ [team]: true }]));
  await waitFor(() => expect(result.current.folded).toEqual(new Set(["trash", team])));
  await waitFor(() => expect(JSON.parse(localStorage.getItem(localCache)!)).toEqual({ folded: ["trash", team], pending: {} }));
});

it("delivers a newer tap after an in-flight write and replays a pending write from a previous visit", async () => {
  localStorage.setItem(localCache, JSON.stringify({ folded: [team], pending: { [team]: true } }));
  const first = hold();
  const puts: Record<string, boolean>[] = [];
  server.use(http.put<never, { changes: Record<string, boolean> }>("/api/ui-sections", async ({ request }) => {
    const { changes } = await request.json();
    puts.push(changes);
    if (puts.length === 1) await first.held;
    return HttpResponse.json({ userId: "local", folded: changes[team] ? [team] : [] });
  }));
  const { result } = renderHook(useBotSections);
  await waitFor(() => expect(puts).toHaveLength(1));
  act(() => result.current.setClosed(team, false));
  first.release();
  await waitFor(() => expect(puts).toEqual([{ [team]: true }, { [team]: false }]));
  await waitFor(() => expect(JSON.parse(localStorage.getItem(localCache)!)).toEqual({ folded: [], pending: {} }));
  expect(result.current.folded.size).toBe(0);
});

it("opens on a corrupt cache and keeps a late response from recreating wiped keys", async () => {
  localStorage.setItem(localCache, "{");
  const get = hold();
  server.use(http.get("/api/ui-sections", async () => {
    await get.held;
    return HttpResponse.json({ userId: "local", folded: ["trash"] });
  }));
  const page = renderHook(useBotSections);
  expect(page.result.current.folded.size).toBe(0);
  page.unmount();
  await wipeDevice("unpair");
  get.release();
  await act(async () => {});
  expect(localStorage.getItem(localCache)).toBeNull();
});

it("reads and patches only the signed-in account's keys, including when the subject is named local", async () => {
  localStorage.setItem(localCache, JSON.stringify({ folded: ["legacy"], pending: {} }));
  const meta = document.createElement("meta");
  meta.name = "collie-sso";
  meta.content = JSON.stringify({ sub: "local", role: "member" });
  document.head.appendChild(meta);
  const seen = vi.fn();
  server.use(
    http.get("/api/user-settings", ({ request }) => {
      expect(request.headers.get("X-Collie-Subject")).toBe("local");
      return HttpResponse.json({ "bot-section:v1:trash": "1", theme: "dark" });
    }),
    http.patch("/api/user-settings", async ({ request }) => {
      seen(request.headers.get("X-Collie-Role"), await request.json());
      return HttpResponse.json({ theme: "dark" });
    }),
  );
  await loadBotSections();
  const { result } = renderHook(useBotSections);
  expect(result.current.folded).toEqual(new Set(["trash"]));
  act(() => result.current.setClosed("trash", false));
  await waitFor(() => expect(seen).toHaveBeenCalledWith("member", { set: {}, remove: ["bot-section:v1:trash"] }));
  expect(JSON.parse(localStorage.getItem(localCache)!).folded).toEqual(["legacy"]);
});

it("cancels an old account's queued tap when a different account opens on the same browser", async () => {
  const meta = document.createElement("meta");
  meta.name = "collie-sso";
  meta.content = JSON.stringify({ sub: "first", role: "member" });
  document.head.appendChild(meta);
  const patch = vi.fn();
  server.use(
    http.get("/api/user-settings", ({ request }) => HttpResponse.json(
      request.headers.get("X-Collie-Subject") === "second" ? { "bot-section:v1:trash": "1" } : {},
    )),
    http.patch("/api/user-settings", ({ request }) => {
      patch(request.headers.get("X-Collie-Subject"));
      return HttpResponse.json({});
    }),
  );
  await loadBotSections();
  const first = renderHook(useBotSections);
  act(() => first.result.current.setClosed(team, true));
  first.unmount();
  meta.content = JSON.stringify({ sub: "second", role: "member" });
  await loadBotSections();
  const second = renderHook(useBotSections);
  expect(second.result.current.folded).toEqual(new Set(["trash"]));
  await act(async () => {
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("online"));
  });
  expect(patch).not.toHaveBeenCalled();
});

it.each([false, true])("waits for the server before presenting the list on a slow online boot (cached=%s)", async cached => {
  if (cached) localStorage.setItem(localCache, JSON.stringify({ folded: [team], pending: {} }));
  const get = hold();
  const received = hold();
  server.use(http.get("/api/ui-sections", async () => {
    received.release();
    await get.held;
    return HttpResponse.json({ userId: "local", folded: ["trash"] });
  }));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const ready = vi.fn();
    const loading = loadBotSections().then(ready);
    await received.held;
    await vi.advanceTimersByTimeAsync(2000);
    expect(ready).not.toHaveBeenCalled();
    get.release();
    await loading;
    const page = renderHook(useBotSections);
    expect(page.result.current.folded).toEqual(new Set(["trash"]));
  } finally {
    get.release();
    vi.useRealTimers();
  }
});


it("opens from disk immediately offline and reconciles on reconnect", async () => {
  localStorage.setItem(localCache, JSON.stringify({ folded: [team], pending: {} }));
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const read = vi.fn();
  server.use(http.get("/api/ui-sections", () => {
    read();
    return HttpResponse.json({ userId: "local", folded: ["trash"] });
  }));
  try {
    await loadBotSections();
    const page = renderHook(useBotSections);
    expect(page.result.current.folded).toEqual(new Set([team]));
    expect(read).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(page.result.current.folded).toEqual(new Set(["trash"])));
  } finally { online.mockRestore(); }
});
