import { Activity, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import type { PaneData } from "@/lib/loaders";
import { PaneScreen } from "@/routes/detail";
import { HomeRoute } from "@/routes/home";
import { StatusArea } from "./status-area";

export function BotStack({ paneId, pane }: { paneId?: string; pane?: PaneData }) {
  const location = useLocation();
  const current = paneId !== undefined && pane ? { paneId, pane, location } : null;
  const last = useRef<typeof current>(null);
  const panel = useRef<HTMLElement>(null);
  const open = current !== null;
  const [parked, setParked] = useState(!open);

  useLayoutEffect(() => {
    if (paneId && pane) last.current = { paneId, pane, location };
  }, [paneId, pane, location]);

  // Keep the departing pane painted until it clears the list. Then pause its
  // subscriptions and shortcuts, retaining the DOM, reading position and draft.
  useLayoutEffect(() => {
    if (open) {
      setParked(false);
      return;
    }
    let cancelled = false;
    const slides = panel.current?.getAnimations?.() ?? [];
    void Promise.allSettled(slides.map(slide => slide.finished)).then(() => {
      return cancelled ? undefined : setParked(true);
    });
    return () => { cancelled = true; };
  }, [open]);

  const screen = current || last.current;
  return <div className="bot-layout" data-detail={open}>
    <aside inert={open} className="bot-sidebar" aria-label="Lista de chats"><HomeRoute /></aside>
    <main inert={!open} className="bot-detail" ref={panel}>
      <Activity mode={open || !parked ? "visible" : "hidden"}>
        {screen && <PaneScreen {...screen} active={open} />}
      </Activity>
    </main>
    <div className="bot-notice"><StatusArea /></div>
  </div>;
}
