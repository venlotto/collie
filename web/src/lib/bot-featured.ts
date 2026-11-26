import { useEffect, useSyncExternalStore } from "react";
import { requestBotFeatured, type SectionAccount } from "./api";
import { botAccountForPage } from "./bot-account";
import { loadBotFeaturedCache, saveBotFeaturedCache } from "./bot-featured-cache";
import { sameBotFeaturedPin, type BotFeaturedPin } from "./bot-featured-wire";
import { paneRowKey } from "./hosts";
import { currentPins, usePins } from "./pins";
import { panePlaceParts } from "./pane-name";
import type { AgentView } from "./types";
import { onWipe } from "./wipe";

export function botFeaturedMatches(pin: BotFeaturedPin, pane: AgentView): boolean {
  return pin.row === paneRowKey(pane) && pin.space === panePlaceParts(pane).space;
}

/** Only an explicit, still-visible pin earns the slot. Focus and list order never provide a fallback. */
export function featuredBotPane(panes: readonly AgentView[], pin: BotFeaturedPin | null): AgentView | undefined {
  return pin ? panes.find(pane => !pane.trash && botFeaturedMatches(pin, pane)) : undefined;
}

export class BotFeaturedStore {
  readonly abort = new AbortController();
  private first?: Promise<void>;
  private request?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: { value: BotFeaturedPin | null };
  private featured: BotFeaturedPin | null = null;
  /** True once this document has heard the server (or SSO store) answer, so a local default can never overwrite it. */
  loaded = false;
  private readonly listeners = new Set<() => void>();

  readonly account: SectionAccount | null;

  constructor(account: SectionAccount | null) {
    this.account = account;
    const cache = account && loadBotFeaturedCache(account.userId);
    if (cache) {
      this.featured = cache.featured;
      this.pending = cache.pending;
    }
  }

  read = () => this.featured;
  hasPending = () => this.pending !== undefined;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(next: BotFeaturedPin | null) {
    const changed = !sameBotFeaturedPin(next, this.featured);
    this.featured = next;
    if (this.account) saveBotFeaturedCache(this.account.userId, { featured: next, pending: this.pending });
    if (changed) for (const listener of this.listeners) listener();
  }

  setPane = (pane: AgentView, on: boolean, now: number = Date.now()) => {
    if (this.abort.signal.aborted) return;
    if (!on && (!this.featured || !botFeaturedMatches(this.featured, pane))) return;
    // Any deliberate pin settles the old per-device pins for good.
    if (on) markLegacyPinsMigrated();
    const next = on ? { row: paneRowKey(pane), space: panePlaceParts(pane).space, at: now } : null;
    this.pending = { value: next };
    this.publish(next);
    clearTimeout(this.timer);
    this.timer = setTimeout(this.flush, 180);
  };

  /** Trash and permanent deletion clear the same preference, only when they name its current owner. */
  clearPane = (pane: AgentView) => this.setPane(pane, false);

  private sync(change?: { value: BotFeaturedPin | null }): Promise<void> {
    if (this.request) return this.request;
    if (!this.account || this.abort.signal.aborted) return Promise.resolve();
    this.request = this.exchange(this.account, change);
    return this.request;
  }

  private async exchange(account: SectionAccount, change?: { value: BotFeaturedPin | null }) {
    try {
      const reply = await requestBotFeatured(account, this.abort.signal, change);
      if (this.abort.signal.aborted || reply.userId !== this.account?.userId) return;
      this.loaded = true;
      if (change && this.pending && sameBotFeaturedPin(this.pending.value, change.value)) this.pending = undefined;
      const next = this.pending ? this.pending.value : reply.featured;
      this.publish(next);
    } catch { /* The local choice and its pending write survive offline. */ }
    finally { this.request = undefined; }
  }

  flush = async () => {
    if (!this.account || this.account.role === "viewer" || this.abort.signal.aborted) return;
    if (this.request) await this.request;
    if (this.pending && !this.abort.signal.aborted) await this.sync(this.pending);
  };

  refresh = async () => {
    await this.sync();
    await this.flush();
  };

  firstRead() {
    if (!this.first) {
      this.first = navigator.onLine === false ? Promise.resolve() : this.sync();
      if (navigator.onLine !== false) void this.first.then(this.flush);
    }
    return this.first;
  }

  dispose() {
    this.abort.abort();
    clearTimeout(this.timer);
    this.pending = undefined;
    this.featured = null;
    for (const listener of this.listeners) listener();
  }
}

let current: BotFeaturedStore | undefined;

export function __resetBotFeatured() {
  current?.dispose();
  current = undefined;
}

function featuredStore(): BotFeaturedStore {
  const account = botAccountForPage();
  if (!current || current.account?.userId !== account?.userId || current.account?.role !== account?.role) {
    current?.dispose();
    current = new BotFeaturedStore(account);
    onWipe("bot-featured-memory", context => {
      if (context.reason === "password") return;
      __resetBotFeatured();
    });
  }
  return current;
}

/** The index and pane loaders wait for this alongside the snapshot, so another device cannot flash the wrong slot. */
export async function loadBotFeatured() {
  await featuredStore().firstRead();
  return null;
}

export function useBotFeatured() {
  const store = featuredStore();
  const featured = useSyncExternalStore(store.subscribe, store.read);
  useEffect(() => {
    void store.firstRead();
    const visibility = () => { if (document.hidden) void store.flush(); else void store.refresh(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", store.refresh);
    window.addEventListener("pagehide", store.flush);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", store.refresh);
      window.removeEventListener("pagehide", store.flush);
    };
  }, [store]);
  return { featured, setFeatured: store.setPane, clearFeatured: store.clearPane };
}

// MIGRATION FROM THE DEVICE'S OLD PINS
// Before the single slot, "Fijar chat" appended to `collie:pins:v1` (lib/pins.ts, up to 32 per device) and the
// slot showed the first pinned chat in list order. Those pins would otherwise vanish from the top. Once per
// device, after the server has answered with NO featured chat and nothing is waiting to be written, the most
// recently pinned old pin whose chat is still visible becomes the one featured chat. A featured chat that
// already exists (this or another device) always wins. The old store is left untouched: the classic
// dashboard's Pinned group still reads it.
const MIGRATED_KEY = "collie:bot-featured:v1:legacy-pins-migrated"; // under the cache prefix, so a device wipe forgets it too

function legacyPinsMigrated(): boolean {
  try { return localStorage.getItem(MIGRATED_KEY) === "1"; } catch { return true; }
}

function markLegacyPinsMigrated(): void {
  try { localStorage.setItem(MIGRATED_KEY, "1"); } catch { /* Without storage the check runs once per load. */ }
}

/** Test seam: forget that this device migrated. */
export function __resetLegacyPinsMigrated(): void {
  try { localStorage.removeItem(MIGRATED_KEY); } catch { /* ignore */ }
}

/** The pane the old pins would have put in the slot: the newest pin whose chat is visible now. */
export function legacyFeaturedPane(panes: readonly AgentView[], pins: readonly { row: string; space: string; at: number }[]): { pane: AgentView; at: number } | undefined {
  let best: { pane: AgentView; at: number } | undefined;
  for (const pin of pins) {
    const pane = panes.find(p => !p.trash && paneRowKey(p) === pin.row && panePlaceParts(p).space === pin.space);
    if (pane && (!best || pin.at > best.at)) best = { pane, at: pin.at };
  }
  return best;
}

/** Mount once on the Grok list with its visible chats. */
export function useLegacyPinMigration(visible: readonly AgentView[]) {
  const store = featuredStore();
  const legacy = usePins();
  useEffect(() => {
    if (legacyPinsMigrated() || visible.length === 0 || !store.account || store.account.role === "viewer") return;
    let live = true;
    void store.firstRead().then(() => {
      if (!live || legacyPinsMigrated() || !store.loaded) return false;
      if (store.read() !== null || store.hasPending()) { markLegacyPinsMigrated(); return false; }
      if (currentPins().length === 0) { markLegacyPinsMigrated(); return false; }
      const found = legacyFeaturedPane(visible, currentPins());
      if (!found) return false; // chats may still be loading; try again on the next change
      store.setPane(found.pane, true, found.at);
      markLegacyPinsMigrated();
      return true;
    });
    return () => { live = false; };
  }, [store, visible, legacy]);
}
