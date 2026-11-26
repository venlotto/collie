import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountStorage, isAccountPreference } from "./koperca-account";

describe("per-account browser state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelector('meta[name="collie-sso"]')?.remove();
    vi.resetModules();
  });

  it("keeps the original browser store and makes no session request with SSO off", async () => {
    const existing = localStorage;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await (await import("./koperca-account")).prepareAccount();
    expect(localStorage).toBe(existing);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks only settings and portraits for server persistence", () => {
    expect(isAccountPreference("collie:design:v1")).toBe(true);
    expect(isAccountPreference("collie:bot:v1:test")).toBe(true);
    expect(isAccountPreference("collie:draft:v2:local")).toBe(false);
    expect(isAccountPreference("collie:device-token")).toBe(false);
    const first = new AccountStorage([["draft", "one"]]);
    const next = new AccountStorage();
    expect(next.getItem("draft")).toBeNull();
    first.removeItem("draft");
    expect(first.length).toBe(0);
  });

  it.each(["member", "viewer", "admin"])("hydrates %s with only the current account's settings", async role => {
    const previous = new Map(["localStorage", "sessionStorage", "caches", "indexedDB"].map(key =>
      [key, Object.getOwnPropertyDescriptor(window, key)] as const));
    const rawSettings = role === "admin" ? {} : { "collie:locale:v1": "es", "collie:device-token": "ignored" };
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      Response.json(init?.method === "PATCH" ? {} : rawSettings));
    localStorage.setItem("collie:device-token", "legacy");
    localStorage.setItem("collie:theme:v1", "dark");
    const marker = document.createElement("meta");
    marker.name = "collie-sso";
    marker.content = JSON.stringify({ sub: "fixture", username: "Fixture", role, legacyOwner: role === "admin" });
    document.head.prepend(marker);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("BroadcastChannel", undefined);
    try {
      const account = await import("./koperca-account");
      await account.prepareAccount();
      expect(account.currentAccount()?.role).toBe(role);
      expect(localStorage.getItem("collie:device-token")).toBeNull();
      expect(localStorage.getItem("collie:theme:v1")).toBe(role === "admin" ? "dark" : null);
      const open = vi.fn(() => { throw new Error("Unexpected disk cache access"); });
      vi.stubGlobal("indexedDB", { open });
      const { putRecord } = await import("./store");
      await putRecord("snapshot", "sample", { example: true });
      expect(open).not.toHaveBeenCalled();
      expect(window.caches).toBeUndefined();
      expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-collie-subject")).toBe("fixture");
      localStorage.setItem("collie:theme:v1", "light");
      localStorage.setItem("collie:draft:v2:private", "private");
      if (role === "viewer") {
        await Promise.resolve();
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } else {
        await vi.waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[1]?.body).toBe(
          JSON.stringify({ set: { "collie:theme:v1": "light" }, remove: [] })));
      }
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("private");
    } finally {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(window, key, descriptor);
        else Reflect.deleteProperty(window, key);
      }
    }
  });
});
