import { renderHook, act } from "@testing-library/react";

import { useIdleLock } from "./use-idle-lock";
import { isLocked, resetIdleLock } from "@/lib/idle";

// The lock exists for exactly one situation: Collie left OPEN, VISIBLE and untouched past the
// deadline. These pin the two rules that produce that, both of which reverse earlier behaviour —
// a hidden page never locks, and returning to the foreground auto-resumes instead of locking.
const IDLE = 1000;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useIdleLock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetIdleLock();
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
    resetIdleLock();
    setVisibility("visible");
  });

  it("locks after idleMs of no interaction while visible", () => {
    renderHook(() => useIdleLock(vi.fn(), IDLE));
    expect(isLocked()).toBe(false);
    act(() => vi.advanceTimersByTime(IDLE));
    expect(isLocked()).toBe(true);
  });

  it("re-arms on real activity (pointerdown / keydown)", () => {
    renderHook(() => useIdleLock(vi.fn(), IDLE));
    act(() => vi.advanceTimersByTime(IDLE - 200));
    act(() => document.dispatchEvent(new Event("pointerdown")));
    // Past the ORIGINAL deadline — but activity re-armed it, so still unlocked.
    act(() => vi.advanceTimersByTime(300));
    expect(isLocked()).toBe(false);
    act(() => vi.advanceTimersByTime(IDLE));
    expect(isLocked()).toBe(true);
  });

  it("never locks a hidden page, however long it stays hidden", () => {
    renderHook(() => useIdleLock(vi.fn(), IDLE));
    act(() => setVisibility("hidden"));
    act(() => vi.advanceTimersByTime(IDLE * 10));
    expect(isLocked()).toBe(false);
  });

  it("returning to the foreground restarts the countdown instead of locking", () => {
    renderHook(() => useIdleLock(vi.fn(), IDLE));
    act(() => setVisibility("hidden"));
    // A long time away — the old behaviour locked the instant this became visible.
    act(() => vi.setSystemTime(Date.now() + IDLE * 5));
    act(() => setVisibility("visible"));
    expect(isLocked()).toBe(false);
    // And the fresh deadline runs from the return, not from the last pre-background interaction.
    act(() => vi.advanceTimersByTime(IDLE - 1));
    expect(isLocked()).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(isLocked()).toBe(true);
  });

  it("auto-resumes when a locked page becomes visible again", () => {
    renderHook(() => useIdleLock(vi.fn(), IDLE));
    act(() => vi.advanceTimersByTime(IDLE)); // locks while visible
    expect(isLocked()).toBe(true);
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    expect(isLocked()).toBe(false);
  });

  it.each(["pointerdown", "touchstart", "keydown", "focus", "pageshow"])(
    "resumes on %s without a visibility event and starts a fresh deadline",
    (type) => {
      const wake = vi.fn();
      renderHook(() => useIdleLock(wake, IDLE));
      act(() => vi.advanceTimersByTime(IDLE));
      expect(isLocked()).toBe(true);
      const event = new Event(type, { bubbles: true, cancelable: true });
      act(() => window.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
      expect(isLocked()).toBe(false);
      expect(wake).toHaveBeenCalledExactlyOnceWith(true);
      act(() => vi.advanceTimersByTime(IDLE));
      expect(isLocked()).toBe(true);
    },
  );

  it("does not wake for a focus or pageshow on a hidden page", () => {
    const wake = vi.fn();
    renderHook(() => useIdleLock(wake, IDLE));
    act(() => setVisibility("hidden"));
    act(() => window.dispatchEvent(new Event("focus")));
    act(() => window.dispatchEvent(new Event("pageshow")));
    expect(wake).not.toHaveBeenCalled();
  });

  it("refreshes a restored page even before the idle deadline", () => {
    const wake = vi.fn();
    renderHook(() => useIdleLock(wake, IDLE));
    const restored = Object.assign(new Event("pageshow"), { persisted: true });
    act(() => window.dispatchEvent(restored));
    expect(wake).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("catches up on input even if the OS suspended the idle timeout", () => {
    const wake = vi.fn();
    renderHook(() => useIdleLock(wake, IDLE));
    vi.setSystemTime(Date.now() + IDLE * 2);
    act(() => document.dispatchEvent(new Event("touchstart", { bubbles: true })));
    expect(wake).toHaveBeenCalledExactlyOnceWith(true);
    expect(isLocked()).toBe(false);
  });
});
