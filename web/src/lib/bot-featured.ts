import { useEffect, useSyncExternalStore } from "react";
import { requestBotFeatured, type SectionAccount } from "./api";
import { botAccountForPage } from "./bot-account";
import { loadBotFeaturedCache, saveBotFeaturedCache } from "./bot-featured-cache";
import { sameBotFeaturedPin, type BotFeaturedPin } from "./bot-featured-wire";
import { paneRowKey } from "./hosts";
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
