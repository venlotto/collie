import { useEffect, useEffectEvent } from "react";

import { isLocked, setLocked } from "@/lib/idle";

const DEFAULT_IDLE_MS = 30 * 60 * 1000;

// The data root owns one deadline alongside its poller. Capture observes the waking gesture
// before a sheet or shortcut handles it, without cancelling its default action or propagation.
export function useIdleLock(onWake: (refreshSnapshot: boolean) => void, idleMs = DEFAULT_IDLE_MS): void {
  const wake = useEffectEvent(onWake);

  useEffect(() => {
    let lastActivity = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    function arm() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") setLocked(true);
      }, idleMs);
    }
    function activity(event: Event) {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      // The OS can suspend the timer as well as omit a visibility event. A first input after
      // the wall-clock deadline should still fetch immediately in that case.
      const paused = isLocked() || now - lastActivity >= idleMs;
      lastActivity = now;
      setLocked(false);
      arm();
      const restored = event.type === "pageshow" && "persisted" in event && event.persisted === true;
      if (paused || restored || event.type === "visibilitychange") {
        wake(true);
      } else if (event.type === "focus") {
        wake(false);
      }
    }
    const inputs = ["pointerdown", "touchstart", "keydown"] as const;
    const capture = { capture: true, passive: true };
    for (const type of inputs) window.addEventListener(type, activity, capture);
    window.addEventListener("focus", activity);
    window.addEventListener("pageshow", activity);
    document.addEventListener("visibilitychange", activity);
    arm();
    return () => {
      clearTimeout(timer);
      for (const type of inputs) window.removeEventListener(type, activity, capture);
      window.removeEventListener("focus", activity);
      window.removeEventListener("pageshow", activity);
      document.removeEventListener("visibilitychange", activity);
      setLocked(false);
    };
  }, [idleMs]);
}
