// The desk: several bot chats open at once on a wide screen (local patch, Koperca Agent Hub).
//
// Pure functions plus one small device-local store. THE URL IS STILL THE TRUTH for the focus: the
// route's pane is the focused window, and everything here is which OTHER chats stay on the desk,
// which are minimised to the tray, and which one fills the desk (maximised).
//
// A window is keyed by the pane's full row key (`paneRowKey`: host, session, pane id), never a bare
// pane id, so `w1:p1` on one machine is never another machine's `w1:p1`.

import { useSyncExternalStore } from "react";
import { asJsonBoolean, asJsonNumber, asJsonObject, asJsonString, parseJsonObject } from "@/lib/json";

export interface DeskWindow {
  /** `paneRowKey` of the pane. */
  key: string;
  /** In the tray instead of on the desk. */
  min: boolean;
  /** When this window last had the focus (ms). Decides which windows a small desk keeps in view. */
  at: number;
}

export interface Desk {
  wins: readonly DeskWindow[];
  /** The one window filling the desk, or null. */
  max: string | null;
}

export const EMPTY_DESK: Desk = { wins: [], max: null };

/** Narrower than this, a chat stops being readable beside another one. */
export const DESK_MIN_WINDOW_WIDTH = 400;
/** Shorter than this, a second row of windows is not worth it. */
export const DESK_MIN_WINDOW_HEIGHT = 340;
export const DESK_GAP = 10;
/** More than two rows would leave each chat a strip. */
export const DESK_MAX_ROWS = 2;
/** A cap on what a device remembers, so a stale store never grows without bound. */
export const DESK_MAX_WINDOWS = 24;

// ── Pure steps ──────────────────────────────────────────────────────────────────────────────────

/** The route arrived at `key`: it is on the desk, out of the tray, and the most recent focus. A
 *  maximised OTHER window steps back, so the window you just opened is never hidden behind it. */
export function arrive(desk: Desk, key: string, now: number): Desk {
  const found = desk.wins.some((w) => w.key === key);
  const wins = found
    ? desk.wins.map((w) => (w.key === key ? { key, min: false, at: now } : w))
    : [...desk.wins, { key, min: false, at: now }];
  return { wins: trim(wins), max: desk.max === key ? key : null };
}

/** A screen with room for one chat opened `key`: it replaces whatever was on the desk, as the single
 *  chat screen always has, so widening the window later shows only what was really open. */
export function solo(key: string, now: number): Desk {
  return { wins: [{ key, min: false, at: now }], max: null };
}

/** Into the tray. A minimised window is never the maximised one. */
export function minimise(desk: Desk, key: string): Desk {
  if (!desk.wins.some((w) => w.key === key && !w.min)) return desk;
  return { wins: desk.wins.map((w) => (w.key === key ? { ...w, min: true } : w)), max: desk.max === key ? null : desk.max };
}

/** Off the desk entirely. The bot itself keeps running and stays in the list. */
export function closeWindow(desk: Desk, key: string): Desk {
  if (!desk.wins.some((w) => w.key === key)) return desk;
  return { wins: desk.wins.filter((w) => w.key !== key), max: desk.max === key ? null : desk.max };
}

export function toggleMax(desk: Desk, key: string): Desk {
  if (!desk.wins.some((w) => w.key === key)) return desk;
  return { ...desk, max: desk.max === key ? null : key };
}

/** Forget windows whose pane is gone. Only called with a LIVE answer: an offline herd says nothing. */
export function prune(desk: Desk, live: ReadonlySet<string>): Desk {
  const wins = desk.wins.filter((w) => live.has(w.key));
  if (wins.length === desk.wins.length) return desk;
  return { wins, max: desk.max !== null && live.has(desk.max) ? desk.max : null };
}

function trim(wins: readonly DeskWindow[]): DeskWindow[] {
  if (wins.length <= DESK_MAX_WINDOWS) return [...wins];
  const keep = new Set(wins.toSorted((a, b) => b.at - a.at).slice(0, DESK_MAX_WINDOWS).map((w) => w.key));
  return wins.filter((w) => keep.has(w.key));
}

/** The next window to hand the focus to when `key` leaves: the most recently focused one still on the desk. */
export function nextFocus(desk: Desk, key: string): string | null {
  const rest = desk.wins.filter((w) => w.key !== key && !w.min).toSorted((a, b) => b.at - a.at);
  return rest[0]?.key ?? null;
}

// ── Geometry ────────────────────────────────────────────────────────────────────────────────────

export interface Capacity {
  cols: number;
  rows: number;
}

/** How many windows fit across and down a desk of this size. */
export function capacityOf(width: number, height: number): Capacity {
  const cols = Math.max(1, Math.floor((width + DESK_GAP) / (DESK_MIN_WINDOW_WIDTH + DESK_GAP)));
  const rows = Math.max(1, Math.min(DESK_MAX_ROWS, Math.floor((height + DESK_GAP) / (DESK_MIN_WINDOW_HEIGHT + DESK_GAP))));
  return { cols, rows };
}

/** True when two windows fit SIDE BY SIDE; below that the single chat screen stays as it was. Two
 *  rows alone never make a desk: a narrow panel split in height reads worse than one chat. */
export function isDesk(c: Capacity): boolean {
  return c.cols >= 2;
}

/**
 * Which windows are on screen, in desk order, and which are in the tray. The focus is always shown.
 * A desk too small for every open window keeps the most recently focused ones and lists the rest in
 * the tray beside the minimised ones, without changing what the device remembers: widen the window
 * and they come back.
 */
export interface DeskLayout {
  /** On the desk, in desk order. */
  shown: string[];
  /** In the tray, in desk order. */
  tray: string[];
}

export function arrange(desk: Desk, focus: string | null, c: Capacity): DeskLayout {
  const open = desk.wins.filter((w) => !w.min || w.key === focus);
  if (desk.max !== null && open.some((w) => w.key === desk.max)) {
    return { shown: [desk.max], tray: desk.wins.filter((w) => w.key !== desk.max).map((w) => w.key) };
  }
  const room = c.cols * c.rows;
  const keep = new Set(
    open
      .toSorted((a, b) => (a.key === focus ? -1 : b.key === focus ? 1 : b.at - a.at))
      .slice(0, room)
      .map((w) => w.key),
  );
  return {
    shown: open.filter((w) => keep.has(w.key)).map((w) => w.key),
    tray: desk.wins.filter((w) => !keep.has(w.key)).map((w) => w.key),
  };
}

/** The grid for `n` windows: one row while they fit across, then two rows, filled evenly. */
export function gridOf(n: number, c: Capacity): Capacity {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n <= c.cols || c.rows === 1) return { cols: Math.min(n, c.cols), rows: 1 };
  const rows = Math.min(c.rows, Math.ceil(n / c.cols));
  return { cols: Math.ceil(n / rows), rows };
}

// ── The store (device-local) ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "koperca:bot-desk:v1";
let state: Desk = load();
const listeners = new Set<() => void>();

function load(): Desk {
  let raw: string | null;
  try {
    raw = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return EMPTY_DESK; // private mode
  }
  const obj = raw === null ? undefined : parseJsonObject(raw);
  const list = obj?.wins;
  if (!Array.isArray(list)) return EMPTY_DESK;
  // Field by field: a bad window is dropped, not the desk.
  const wins: DeskWindow[] = [];
  for (const item of list) {
    const w = asJsonObject(item);
    const key = asJsonString(w?.key);
    if (key === undefined || key === "" || wins.some((x) => x.key === key)) continue;
    wins.push({ key, min: asJsonBoolean(w?.min) === true, at: asJsonNumber(w?.at) ?? 0 });
  }
  const max = asJsonString(obj?.max);
  return { wins: trim(wins), max: max !== undefined && wins.some((w) => w.key === max) ? max : null };
}

export function deskState(): Desk {
  return state;
}

export function setDesk(next: Desk): void {
  if (next === state) return;
  state = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* A private window keeps the desk for this visit only. */
  }
  for (const l of listeners) l();
}

export function updateDesk(step: (d: Desk) => Desk): Desk {
  setDesk(step(state));
  return state;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDesk(): Desk {
  return useSyncExternalStore(subscribe, deskState, deskState);
}

/** Tests only. */
export function __resetDesk(): void {
  state = load();
  for (const l of listeners) l();
}
