import { basePath, mounted } from "./base-path";
import { asJsonString, parseJsonObject } from "./json";

export interface Account {
  sub: string;
  username: string;
  role: "admin" | "member" | "viewer";
  legacyOwner: boolean;
}

let current: Account | undefined;
let announce: ((sub: string | null) => void) | undefined;
let leaving = false;
let saving: Promise<void> | undefined;
const pending = new Map<string, string | null>();
export const currentAccount = () => current;

function readAccount(raw: string): Account {
  const value = parseJsonObject(raw);
  const sub = asJsonString(value?.sub);
  const username = asJsonString(value?.username);
  const role = value?.role;
  if (!sub || !username || (role !== "admin" && role !== "member" && role !== "viewer")) {
    throw new Error("Invalid account");
  }
  return { sub, username, role, legacyOwner: value?.legacyOwner === true };
}

// Only preferences and the user's bot portraits cross to the settings store.
// Device tokens, drafts, visited panes and cached transcripts stay out of it.
const preferences = new Set([
  "theme:v1", "design:v1", "themes:v1", "key-board:v1", "display-prefs:v4",
  "dash-prefs:v1", "locale:v1", "haptics:v1", "harness-bar:v1", "harness-prefs:v1",
  "strips-collapsed:v1", "stt-hands-free:v1", "stt-engine:v1", "zen-enabled:v1",
  "auto-zen-enabled:v1", "pins:v1", "wide-layout:v1", "wide-sidebar:v1",
  "project-pictures:v1", "enter-sends:v1", "diff-layout:v1", "wide-layout-mode:v1",
  "hidden-machines:v1", "tour:v1", "new-page:kind:v1",
]);

export function isAccountPreference(key: string): boolean {
  return key.startsWith("collie:bot:v1:") || key.startsWith("collie:mirror-native:") ||
    (key.startsWith("collie:") && preferences.has(key.slice(7)));
}

type Change = (key: string, value: string | null) => void;

/** Per-document storage for the existing synchronous preference and draft readers. */
export class AccountStorage implements Storage {
  #values: Map<string, string>;
  #change: Change;
  constructor(entries: [string, string][] = [], change: Change = () => {}) {
    this.#values = new Map(entries);
    this.#change = change;
  }
  get length() { return this.#values.size; }
  key(index: number) { return Array.from(this.#values.keys())[index] ?? null; }
  getItem(key: string) { return this.#values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.getItem(key) === value) return;
    this.#values.set(key, value);
    this.#change(key, value);
  }
  removeItem(key: string) {
    if (this.#values.delete(key)) this.#change(key, null);
  }
  clear() {
    for (const key of this.#values.keys()) this.removeItem(key);
  }
}

function leave(path: string) {
  if (leaving) return;
  leaving = true;
  document.body.replaceChildren();
  window.location.replace(mounted(path));
}

/** Each tab names the subject it rendered, including on a later logout or settings write. */
export function accountFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!current) return fetch(path, init);
  const headers = new Headers(init?.headers);
  headers.set("X-Collie-Subject", encodeURIComponent(current.sub));
  headers.set("X-Collie-Role", current.role);
  return fetch(path, { ...init, headers, cache: "no-store", redirect: "manual" }).then(res => {
    if (res.status === 401) leave("/auth/login");
    if (res.headers.get("X-Collie-Session") === "changed") leave("/");
    return res;
  });
}

async function patchSettings(set: Record<string, string>, remove: string[]) {
  const body = JSON.stringify({ set, remove });
  const reply = await accountFetch(mounted("/api/user-settings"), {
    method: "PATCH", headers: { "content-type": "application/json" },
    body, keepalive: new TextEncoder().encode(body).length < 60_000,
  });
  if (!reply.ok) throw new Error("Settings save failed");
}

// Persist only changed keys; concurrent tabs may be editing unrelated settings.
async function flushSettings() {
  while (pending.size) {
    if (leaving) return;
    const batch = new Map(pending);
    const set: [string, string][] = [];
    const remove: string[] = [];
    for (const [key, value] of batch) {
      if (value === null) remove.push(key);
      else set.push([key, value]);
    }
    await patchSettings(Object.fromEntries(set), remove);
    for (const [key, value] of batch) if (pending.get(key) === value) pending.delete(key);
  }
}

function saveSettings(): Promise<void> {
  saving ??= flushSettings().then(() => {
    document.getElementById("account-save-retry")?.remove();
    saving = undefined;
    if (pending.size && !leaving) return saveSettings();
    return;
  }).catch(() => {
    saving = undefined;
    if (leaving || document.getElementById("account-save-retry")) return;
    const retry = document.createElement("button");
    retry.id = "account-save-retry";
    retry.textContent = "Ajustes sin guardar · Reintentar";
    retry.addEventListener("click", () => { retry.remove(); void saveSettings(); });
    document.body.prepend(retry);
  });
  return saving;
}

function queueSetting(key: string, value: string | null) {
  if (!isAccountPreference(key) || current?.role === "viewer" || leaving) return;
  pending.set(key, value);
  void saveSettings();
}

export function showAccountError() {
  if (leaving) return;
  const root = document.getElementById("root");
  if (!root) return;
  const button = document.createElement("button");
  button.textContent = "Reintentar";
  button.addEventListener("click", () => location.reload());
  root.replaceChildren("No se pudo cargar o guardar la configuración de tu cuenta. ", button);
}

// Existing navigation state may contain the pending pane's preview and labels.
// Drop it at document boundaries and on Back before the router reads that entry.
function discardHistoryPreview() {
  const state = history.state;
  if (state?.usr) history.replaceState({ ...state, usr: null }, "");
}

async function removeOldWorker() {
  const registration = await navigator.serviceWorker?.getRegistration?.(basePath());
  if (registration?.scope !== new URL(basePath(), location.href).href) return;
  await registration?.unregister();
}

export async function prepareAccount() {
  const marker = document.querySelector('meta[name="collie-sso"]');
  if (!marker) return;
  const account = readAccount(marker.getAttribute("content") ?? "");
  current = account;
  const reply = await accountFetch(mounted("/api/user-settings"));
  if (!reply.ok) throw new Error("Account unavailable");
  const raw = parseJsonObject(await reply.text());
  if (!raw) throw new Error("Invalid settings");
  const entries: [string, string][] = [];
  for (const [key, data] of Object.entries(raw)) {
    const value = asJsonString(data);
    if (value !== undefined && isAccountPreference(key)) entries.push([key, value]);
  }
  // On a previously used origin, only the explicitly designated owner may
  // import legacy preferences. Other accounts never read persistent storage.
  if (account.legacyOwner && account.role !== "viewer" && Object.keys(raw).length === 0) {
    const storage = window.localStorage;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null || !isAccountPreference(key)) continue;
      const value = storage.getItem(key);
      if (value !== null) entries.push([key, value]);
    }
    if (entries.length) await patchSettings({ ...Object.fromEntries(entries), legacyBrowserImported: "1" }, []);
  }
  Object.defineProperties(window, {
    localStorage: { configurable: true, value: new AccountStorage(entries, queueSetting) },
    sessionStorage: { configurable: true, value: new AccountStorage() },
    caches: { configurable: true, value: undefined },
  });
  window.addEventListener("storage", event => event.stopImmediatePropagation(), true);
  discardHistoryPreview();
  window.addEventListener("popstate", discardHistoryPreview, true);
  await removeOldWorker();
  if (window.BroadcastChannel) {
    const channel = new BroadcastChannel("collie-account");
    channel.addEventListener("message", event => {
      if (event.data !== account.sub) leave("/");
    });
    announce = channel.postMessage.bind(channel);
    announce(account.sub);
  }
  window.addEventListener("pagehide", () => { document.documentElement.style.visibility = "hidden"; });
  window.addEventListener("pageshow", event => { if (event.persisted) leave("/"); });
  // Check before revealing a tab left open while another user signed in.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      document.documentElement.style.visibility = "hidden";
      return;
    }
    void accountFetch(mounted("/auth/me")).then(async res => {
      if (!res.ok) return leave("/auth/login");
      const me = parseJsonObject(await res.text());
      if (me?.sub !== current?.sub || me?.role !== current?.role) return leave("/");
      document.documentElement.style.visibility = "";
      return;
    }).catch(() => leave("/"));
  });
}

export async function signOutAccount() {
  await saveSettings();
  const reply = await accountFetch(mounted("/auth/logout"), { method: "POST" });
  if (!reply.ok && reply.status !== 303 && reply.type !== "opaqueredirect") throw new Error("Logout failed");
  announce?.(null);
  leave("/auth/login");
}
