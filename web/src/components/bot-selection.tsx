import { useEffect, useRef, type ReactNode } from "react";
import { Check, X } from "lucide-react";

interface RowProps {
  children: ReactNode;
  current: boolean;
  checked?: boolean;
  disabled?: boolean;
  onHold?: () => void;
  onOpen: () => void;
  onPress: () => void;
}

/** Leave vertical scrolling to the browser. Consume exactly the click after a successful hold. */
export function BotRow({ children, current, checked, disabled, onHold, onOpen, onPress }: RowProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef({ x: 0, y: 0 });
  const held = useRef(false);
  const row = useRef<HTMLButtonElement>(null);
  const cancel = () => clearTimeout(timer.current);
  useEffect(() => cancel, []);
  function hold() {
    cancel();
    if (held.current || !onHold) return;
    held.current = true;
    onHold();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      row.current?.animate([{ transform: "scale(1)" }, { transform: "scale(.975)" }, { transform: "scale(1)" }], 190);
    }
  }
  return <button ref={row} type="button" className="bot-row" aria-current={current || undefined}
    role={checked === undefined ? undefined : "checkbox"} aria-checked={checked} disabled={disabled}
    onContextMenu={e => { if (onHold) { e.preventDefault(); hold(); } }}
    onPointerDown={e => {
      cancel();
      held.current = false;
      if (e.button !== 0 || !e.isPrimary) return;
      start.current = { x: e.clientX, y: e.clientY };
      onPress();
      if (onHold) timer.current = setTimeout(hold, 450);
    }}
    onPointerMove={e => { if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 9) cancel(); }}
    onPointerLeave={cancel} onPointerCancel={cancel} onPointerUp={cancel}
    onClick={e => { if (!held.current || e.detail === 0) onOpen(); held.current = false; }}>
    {checked !== undefined && <span aria-hidden className="bot-check">{checked && <Check size={14} strokeWidth={3} />}</span>}
    {children}
  </button>;
}

export function BotActionSheet({ title, children, busy, close, leaving, dismiss }: {
  title: string; children: ReactNode; busy: boolean; leaving: boolean; close: () => void; dismiss: () => void;
}) {
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
    <button aria-label="Descartar" tabIndex={-1} className="bot-backdrop" disabled={busy} onClick={dismiss} />
    <div className="bot-sheet bot-action-sheet">
      <header><button className="bot-circle" disabled={busy} onClick={dismiss} aria-label="Cerrar"><X /></button><h2>{title}</h2></header>
      {children}
    </div>
  </dialog>;
}
