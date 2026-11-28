import { t } from "@/lib/i18n";
import { useLocale } from "@/hooks/use-locale";
import { useEffect, useRef, type ReactNode } from "react";
import { Check, Trash2, X } from "lucide-react";

interface RowProps {
  children: ReactNode;
  current: boolean;
  checked?: boolean;
  disabled?: boolean;
  onHold?: () => void;
  onSwipeRight?: () => void;
  onOpen: () => void;
  onPress: () => void;
}

/** Leave vertical scrolling to the browser. Consume exactly the click after a successful hold. */
export function BotRow({ children, current, checked, disabled, onHold, onSwipeRight, onOpen, onPress }: RowProps) {
  useLocale();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef({ x: 0, y: 0 });
  const held = useRef(false);
  const row = useRef<HTMLButtonElement>(null);
  const swipe = useRef<{ id: number; x: number; y: number; right: boolean } | null>(null);
  const swipeEnabled = !!onSwipeRight && !disabled && checked === undefined;
  function resetSwipe() {
    swipe.current = null;
    row.current?.style.removeProperty("--bot-swipe-x");
    row.current?.removeAttribute("data-swiping");
    row.current?.removeAttribute("data-swipe-ready");
  }
  useEffect(() => { if (!swipeEnabled) resetSwipe(); }, [swipeEnabled]);
  useEffect(() => {
    const blur = () => { clearTimeout(timer.current); resetSwipe(); };
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, []);
  const cancel = () => clearTimeout(timer.current);
  useEffect(() => cancel, []);
  function hold() {
    cancel();
    if (held.current || !onHold) return;
    held.current = true;
    resetSwipe();
    onHold();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      row.current?.animate([{ transform: "scale(1)" }, { transform: "scale(.975)" }, { transform: "scale(1)" }], 190);
    }
  }
  return <div className="bot-swipe">
    {swipeEnabled && <span className="bot-swipe-hint" aria-hidden="true"><Trash2 size={20} />{t("chat.card.delete")}</span>}
    <button ref={row} data-swipeable={swipeEnabled || undefined} type="button" className="bot-row" aria-current={current || undefined}
    role={checked === undefined ? undefined : "checkbox"} aria-checked={checked} disabled={disabled}
    onContextMenu={e => { if (onHold) { e.preventDefault(); hold(); } }}
    onPointerDown={e => {
      cancel();
      held.current = false;
      resetSwipe();
      if (e.button !== 0 || !e.isPrimary) return;
      start.current = { x: e.clientX, y: e.clientY };
      if (swipeEnabled && (e.pointerType === "touch" || e.pointerType === "pen")) {
        swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, right: false };
      }
      onPress();
      if (onHold) timer.current = setTimeout(hold, 450);
    }}
    onPointerMove={e => {
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 9) cancel();
      const gesture = swipe.current;
      if (!gesture || gesture.id !== e.pointerId) return;
      const dx = e.clientX - gesture.x, dy = Math.abs(e.clientY - gesture.y);
      if (!gesture.right) {
        if (dx > 12 && dx > dy * 1.5) {
          gesture.right = true;
          held.current = true; // Suppress the compatibility click even when the swipe is cancelled.
          // Touch and pen retain their implicit pointer capture until release or cancellation.
        } else if (dy > 12 || dx < -12) { resetSwipe(); return; }
      }
      if (!gesture.right) return;
      if (dy > 40 && dy > Math.abs(dx)) { resetSwipe(); return; }
      e.preventDefault();
      row.current?.setAttribute("data-swiping", "");
      row.current?.toggleAttribute("data-swipe-ready", dx >= 96 && dx > dy * 1.5);
      row.current?.style.setProperty("--bot-swipe-x", Math.min(140, Math.max(0, dx)) + "px");
    }}
    onPointerLeave={() => { cancel(); if (!swipe.current?.right) resetSwipe(); }}
    onPointerCancel={() => { cancel(); resetSwipe(); }}
    onPointerUp={e => {
      cancel();
      const gesture = swipe.current;
      const dx = gesture ? e.clientX - gesture.x : 0;
      const commit = swipeEnabled && gesture?.id === e.pointerId && gesture.right && dx >= 96 && dx > Math.abs(e.clientY - gesture.y) * 1.5;
      resetSwipe();
      if (commit) onSwipeRight?.();
    }}
    onClick={e => { if (!held.current || e.detail === 0) onOpen(); held.current = false; }}>
    {checked !== undefined && <span aria-hidden className="bot-check">{checked && <Check size={14} strokeWidth={3} />}</span>}
    {children}
  </button></div>;
}

export function BotActionSheet({ title, children, busy, close, leaving, dismiss }: {
  title: string; children: ReactNode; busy: boolean; leaving: boolean; close: () => void; dismiss: () => void;
}) {
  useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => closeRef.current(), 260);
    return () => clearTimeout(timer);
  }, [leaving]);
  return <dialog className="bot-dialog" ref={dialog} data-leaving={leaving} aria-label={title}
    onCancel={e => { e.preventDefault(); if (!busy) dismiss(); }}>
    <button aria-label={t("composer.held.dismiss")} tabIndex={-1} className="bot-backdrop" disabled={busy} onClick={dismiss} />
    <div className="bot-sheet bot-action-sheet">
      <header><button className="bot-circle" disabled={busy} onClick={dismiss} aria-label={t("common.closeAria")}><X /></button><h2>{title}</h2></header>
      {children}
    </div>
  </dialog>;
}
