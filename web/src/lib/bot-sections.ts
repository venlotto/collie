import { useEffect, useSyncExternalStore } from "react";
import { requestBotSections, type SectionAccount } from "./api";
import { loadSectionCache, saveSectionCache } from "./bot-section-cache";
import { onWipe } from "./wipe";
import { asJsonString, parseJsonObject } from "./json";

function accountForPage(): SectionAccount | null {
  const marker = document.querySelector('meta[name="collie-sso"]');
  if (!marker) return { userId: "local" };
  const account = parseJsonObject(marker.getAttribute("content") ?? "");
  const sub = asJsonString(account?.sub);
  const role = asJsonString(account?.role);
  return sub && (role === "admin" || role === "member" || role === "viewer")
    ? { userId: "sso:" + sub, sub, role } : null;
}

class BotSections {
  readonly abort = new AbortController();
  private first?: Promise<void>;
  private request?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private pending = new Map<string, boolean>();
  private folded = new Set<string>();
  private readonly listeners = new Set<() => void>();

  readonly account: SectionAccount | null;

  constructor(account: SectionAccount | null) {
    this.account = account;
    const cache = account && loadSectionCache(account.userId);
    if (cache) {
      this.folded = cache.folded;
      this.pending = cache.pending;
    }
  }
  read = () => this.folded;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(next: Set<string>) {
    const changed = next.size !== this.folded.size || [...next].some(id => !this.folded.has(id));
    if (changed) this.folded = next;
    if (this.account) saveSectionCache(this.account.userId, next, this.pending);
    if (changed) for (const listener of this.listeners) listener();
  }
  toggle = (key: string) => this.setClosed(key, !this.folded.has(key));
  setClosed = (key: string, closed: boolean) => {
    if (this.folded.has(key) === closed || this.abort.signal.aborted) return;
    this.pending.set(key, closed);
    const next = new Set(this.folded);
    if (closed) next.add(key); else next.delete(key);
    this.publish(next);
    clearTimeout(this.timer);
    this.timer = setTimeout(this.flush, 180);
  };

  // Only one request is in flight per account and document. A response merges with every
  // newer tap, including one made while its write was in flight. A failed write stays pending
  // in the first-paint cache for a reload, another tap or the next return online.
  private sync(changes?: Map<string, boolean>): Promise<void> {
    if (this.request) return this.request;
    if (!this.account || this.abort.signal.aborted) return Promise.resolve();
    this.request = this.exchange(this.account, changes);
    return this.request;
  }

  private async exchange(account: SectionAccount, changes?: Map<string, boolean>) {
    try {
      const reply = await requestBotSections(account, this.abort.signal, changes && Object.fromEntries(changes));
      if (this.abort.signal.aborted || reply.userId !== this.account?.userId || !Array.isArray(reply.folded)) return;
      for (const [id, value] of changes ?? []) {
        if (this.pending.get(id) === value) this.pending.delete(id);
      }
      const next = new Set(reply.folded);
      for (const [id, closed] of this.pending) {
        if (closed) next.add(id); else next.delete(id);
      }
      this.publish(next);
    } catch { /* The last local choices survive an offline or refused read/write. */ }
    finally { this.request = undefined; }
  }

  flush = async () => {
    if (!this.account || this.account.role === "viewer" || this.abort.signal.aborted) return;
    if (this.request) await this.request;
    if (this.pending.size && !this.abort.signal.aborted) await this.sync(new Map(this.pending));
  };
  refresh = async () => {
    await this.sync();
    await this.flush();
  };
  firstRead() {
    if (!this.first) {
      // The online loader waits for the same authoritative read on every device. Even a
      // warm cache can be stale after a toggle elsewhere. Offline, paint from disk at once.
      this.first = navigator.onLine === false ? Promise.resolve() : this.sync();
      if (navigator.onLine !== false) void this.first.then(this.flush);
    }
    return this.first;
  }
  dispose() {
    this.abort.abort();
    clearTimeout(this.timer);
    this.pending.clear();
    this.folded = new Set();
    for (const listener of this.listeners) listener();
  }
}

let current: BotSections | undefined;
function sections() {
  const account = accountForPage();
  if (!current || current.account?.userId !== account?.userId || current.account?.role !== account?.role) {
    current?.dispose();
    current = new BotSections(account);
    onWipe("bot-section-memory", context => {
      if (context.reason === "password") return;
      current?.dispose();
      current = undefined;
    });
  }
  return current;
}

// The index and pane loaders run this alongside their snapshot. On a second device there
// is no local copy yet; waiting here means the first visible list already has the right shape.
export async function loadBotSections() {
  await sections().firstRead();
  return null;
}

export function useBotSections() {
  const store = sections();
  const folded = useSyncExternalStore(store.subscribe, store.read);
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
  return { folded, toggle: store.toggle, setClosed: store.setClosed };
}
