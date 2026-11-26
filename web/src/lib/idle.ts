import { useSyncExternalStore } from "react";

// The polling timer reads the current value directly. The app shell subscribes so the same
// deadline also pauses CSS animations without changing the layout or the focused control.
let locked = false;
const listeners = new Set<() => void>();

export function isLocked(): boolean {
  return locked;
}

export function setLocked(next: boolean): void {
  if (locked === next) return;
  locked = next;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useLocked(): boolean {
  return useSyncExternalStore(subscribe, isLocked, isLocked);
}

export function resetIdleLock(): void {
  locked = false;
  listeners.clear();
}
