import { useLayoutEffect, useRef } from "react";
import { hasResizeObserver } from "@/lib/env";
import { MENU_MARGIN, placeMenu } from "@/lib/menu-place";

/** A native popover lives in the top layer; measure its own window and trigger there.
 * Shared CSS anchor names can otherwise send one chat's menu to another window. */
export function useBotMenuPlacement(enabled: boolean) {
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const button = trigger.current;
    const panel = popup.current;
    const owner = button?.closest<HTMLElement>(".bot-window");
    if (!enabled || !button || !panel || !owner) return;
    let frame = 0;
    const place = () => {
      if (!panel.matches(":popover-open")) return;
      const bounds = owner.getBoundingClientRect();
      const anchor = button.getBoundingClientRect();
      panel.style.width = `${Math.min(360, Math.max(0, bounds.width - 2 * MENU_MARGIN))}px`;
      const at = placeMenu({
        anchor: { left: anchor.left - bounds.left, top: anchor.top - bounds.top, width: anchor.width, height: anchor.height },
        panel: { width: panel.offsetWidth, height: panel.scrollHeight + panel.offsetHeight - panel.clientHeight },
        window: { width: bounds.width, height: bounds.height },
      });
      panel.style.inset = "auto";
      panel.style.left = `${bounds.left + at.left}px`;
      panel.style.top = `${bounds.top + at.top}px`;
      panel.style.maxHeight = `${at.maxHeight}px`;
      panel.style.margin = "0";
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    // beforetoggle schedules the measurement after opening, before the first visible frame.
    panel.addEventListener("beforetoggle", schedule);
    const resizes = hasResizeObserver() ? new ResizeObserver(schedule) : null;
    resizes?.observe(owner);
    resizes?.observe(panel);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resizes?.disconnect();
      panel.removeEventListener("beforetoggle", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, { capture: true });
      for (const property of ["width", "inset", "left", "top", "max-height", "margin"]) panel.style.removeProperty(property);
    };
  }, [enabled]);
  return { trigger, popup };
}
