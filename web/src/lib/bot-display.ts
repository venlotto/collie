import { useEffect, useSyncExternalStore } from "react";
import { requestBotDisplays, type SectionAccount } from "./api";
import { botAccountForPage } from "./bot-account";
import { loadBotDisplayCache, saveBotDisplayCache } from "./bot-display-cache";
import type { BotDisplay, BotDisplayRow } from "./bot-display-wire";
import { paneRowKey } from "./hosts";
import type { Scope } from "./scope";
import type { AgentView } from "./types";
import { onWipe } from "./wipe";

export class BotDisplayStore {
  readonly abort = new AbortController();
  private first?: Promise<void>;
  private request?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private pending = new Map<string, BotDisplay>();
  private views = new Map<string, BotDisplay>();
  private readonly listeners = new Set<() => void>();

  readonly account: SectionAccount | null;

  constructor(account: SectionAccount | null) {
    this.account = account;
    const cache = account && loadBotDisplayCache(account.userId);
    if (cache) {
      this.views = cache.views;
      this.pending = cache.pending;
    }
  }

  read = () => this.views;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(next: Map<string, BotDisplay>) {
    const changed = next.size !== this.views.size || [...next].some(([row, view]) => this.views.get(row) !== view);
    if (changed) this.views = next;
    if (this.account) saveBotDisplayCache(this.account.userId, { views: this.views, pending: this.pending });
    if (changed) for (const listener of this.listeners) listener();
  }

  setRow = (change: BotDisplayRow) => {
    if (this.abort.signal.aborted || this.views.get(change.row) === change.view) return;
    this.pending.set(change.row, change.view);
    this.publish(new Map(this.views).set(change.row, change.view));
    clearTimeout(this.timer);
    this.timer = setTimeout(this.flush, 180);
  };

  private sync(change?: BotDisplayRow): Promise<void> {
    if (this.request) return this.request;
    if (!this.account || this.abort.signal.aborted) return Promise.resolve();
    this.request = this.exchange(this.account, change);
    return this.request;
  }

  private async exchange(account: SectionAccount, change?: BotDisplayRow) {
    try {
      const reply = await requestBotDisplays(account, this.abort.signal, change);
      if (this.abort.signal.aborted || reply.userId !== this.account?.userId) return;
      if (change && this.pending.get(change.row) === change.view) this.pending.delete(change.row);
      const next = new Map(reply.views.map(row => [row.row, row.view]));
      for (const [row, view] of this.pending) next.set(row, view);
      this.publish(next);
    } catch { /* The last local choice and its pending write survive offline. */ }
    finally { this.request = undefined; }
  }

  flush = async () => {
    if (!this.account || this.account.role === "viewer" || this.abort.signal.aborted) return;
    if (this.request) await this.request;
    const next = [...this.pending][0];
    if (next && !this.abort.signal.aborted) {
      await this.sync({ row: next[0], view: next[1] });
      // A failed write stays pending for the next online/visibility retry, never a tight loop.
      if (this.pending.get(next[0]) === next[1]) return;
    }
    if (this.pending.size && !this.abort.signal.aborted) await this.flush();
  };

  refresh = async () => {
    await this.sync();
    await this.flush();
  };

  firstRead() {
    if (!this.first) {
      // The online loader waits for the authoritative read so another device's choice cannot flash Terminal.
      this.first = navigator.onLine === false ? Promise.resolve() : this.sync();
      if (navigator.onLine !== false) void this.first.then(this.flush);
    }
    return this.first;
  }

  dispose() {
    this.abort.abort();
    clearTimeout(this.timer);
    this.pending.clear();
    this.views = new Map();
    for (const listener of this.listeners) listener();
  }
}

let current: BotDisplayStore | undefined;

export function __resetBotDisplays() {
  current?.dispose();
  current = undefined;
}

function displayStore(): BotDisplayStore {
  const account = botAccountForPage();
  if (!current || current.account?.userId !== account?.userId || current.account?.role !== account?.role) {
    current?.dispose();
    current = new BotDisplayStore(account);
    onWipe("bot-display-memory", context => {
      if (context.reason === "password") return;
      __resetBotDisplays();
    });
  }
  return current;
}

export async function loadBotDisplays() {
  await displayStore().firstRead();
  return null;
}

/** Explicit create-time default, also shared by tests and the Create Bot flow. */
export function setBotDisplay(scope: Scope, paneId: string, view: BotDisplay) {
  displayStore().setRow({ row: paneRowKey({ host: scope.host, session: scope.session, paneId }), view });
}

export function useBotDisplays() {
  const store = displayStore();
  const views = useSyncExternalStore(store.subscribe, store.read);
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
  return {
    views,
    viewFor: (pane: AgentView): BotDisplay => views.get(paneRowKey(pane)) ?? "chat",
    setView: (pane: AgentView, view: BotDisplay) => store.setRow({ row: paneRowKey(pane), view }),
  };
}
