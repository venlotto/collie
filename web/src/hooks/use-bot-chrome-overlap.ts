import { useLayoutEffect, useState, type RefObject } from "react";

import { hasResizeObserver } from "@/lib/env";

/** Keep the chat scrollport's lower clearance equal to its floating composer. */
export function useBotChromeOverlap(root: RefObject<HTMLElement | null>) {
  const [bottom, setBottom] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const chat = root.current;
    if (chat === null) return;
    const measure = () => {
      const height = bottom === null ? 0 : Math.ceil(bottom.getBoundingClientRect().height);
      chat.style.setProperty("--bot-bottom-overlap", `${height}px`);
    };
    measure();
    if (bottom === null || !hasResizeObserver()) {
      return () => chat.style.removeProperty("--bot-bottom-overlap");
    }
    const observer = new ResizeObserver(measure);
    observer.observe(bottom);
    return () => {
      observer.disconnect();
      chat.style.removeProperty("--bot-bottom-overlap");
    };
  }, [root, bottom]);
  return setBottom;
}
