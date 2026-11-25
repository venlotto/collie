import { useEffect, useRef, useState, type RefObject } from "react";

export interface Drop {
  source: string;
  pane?: string;
  target: string;
  before: string | null;
  trash: boolean;
}

const SLOP = 10;
const HOLD = 450;
const ARM_TOUCH = 140;

/** Touch swipes before 140 ms scroll. From 140–450 ms, 10 px takes the drag.
 * A stationary 450 ms press belongs to the row selection or the workspace menu. */
export function useBotDrag(listRef: RefObject<HTMLDivElement | null>, enabled: boolean,
  onDrop: (drop: Drop) => void, onMenu: (workspace: string) => void) {
  const callbacks = useRef({ onDrop, onMenu });
  callbacks.current = { onDrop, onMenu };
  const [draggingChat, setDraggingChat] = useState(false);
  useEffect(() => {
    const list = listRef.current;
    if (!enabled || !list) return;
    const shell = list.closest(".bot-index")!;
    let pending: {
      id: number; touch: boolean; start: number; x: number; y: number; node: HTMLElement;
      section: HTMLElement; pane?: string;
    } | null = null;
    let ghost: HTMLElement | null = null;
    let timer = 0, frame = 0, suppress = false;
    let clientX = 0, clientY = 0, left = 0, top = 0;
    let drop: Drop | null = null;
    let targetSection: HTMLElement | null = null;
    const shifted = new Set<HTMLElement>();

    function clear() {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      ghost?.remove();
      ghost = null;
      pending?.node.removeAttribute("data-lifted");
      targetSection?.removeAttribute("data-over");
      targetSection = null;
      for (const el of shifted) el.style.removeProperty("--drag-shift");
      shifted.clear();
      shell.querySelector("[data-trash-over]")?.removeAttribute("data-trash-over");
      setDraggingChat(false);
      pending = null;
      drop = null;
    }
    function frameAtPointer() {
      if (!pending || !ghost) return;
      ghost.style.transform = `translate3d(${clientX - left}px,${clientY - top}px,0) scale(1.025)`;
      const source = pending.section.dataset.workspace!;
      const trash = shell.querySelector<HTMLElement>(".bot-drop-trash");
      const trashBox = trash?.getBoundingClientRect();
      const overTrash = !!trashBox && clientX >= trashBox.left && clientX <= trashBox.right && clientY >= trashBox.top && clientY <= trashBox.bottom;
      trash?.toggleAttribute("data-trash-over", overTrash);
      const box = list!.getBoundingClientRect();
      const inList = clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
      const sections = Array.from(list!.querySelectorAll<HTMLElement>("section[data-drag-space]"));
      let section: HTMLElement | undefined;
      if (inList && !overTrash) {
        // The inter-section margin belongs to the following section. Ignore the featured chat.
        section = sections.find((s, i) => {
          const rect = s.getBoundingClientRect();
          return clientY >= rect.top - (i ? 14 : 0) && clientY <= rect.bottom;
        });
        const edge = 50;
        const bottom = trashBox?.top ?? box.bottom;
        if (clientY < box.top + edge) list!.scrollTop -= Math.ceil((box.top + edge - clientY) / 5);
        else if (clientY > bottom - edge) list!.scrollTop += Math.ceil((clientY - bottom + edge) / 5);
      }
      if (section?.dataset.dragScope !== pending.section.dataset.dragScope) section = undefined;
      if (targetSection !== section) {
        targetSection?.removeAttribute("data-over");
        targetSection = section ?? null;
      }
      targetSection?.setAttribute("data-over", "");
      let before: string | null = null;
      const shifts = new Map<HTMLElement, number>();
      if (section && pending.pane) {
        const rows = Array.from(section.querySelectorAll<HTMLElement>("li[data-drag-pane]"));
        const others = rows.filter(row => row.dataset.dragPane !== pending!.pane);
        const overHeader = clientY < (section.querySelector(".bot-group")?.getBoundingClientRect().bottom ?? 0);
        const anchor = !overHeader && others.find(row => {
          const rect = row.getBoundingClientRect();
          return clientY < rect.top + rect.height / 2;
        });
        before = anchor ? anchor.dataset.dragPane! : null;
        const insertion = anchor ? others.indexOf(anchor) : others.length;
        const height = pending.node.offsetHeight;
        others.forEach((row, i) => {
          const step = i + Number(i >= insertion) - rows.indexOf(row);
          if (step && row.firstElementChild instanceof HTMLElement) shifts.set(row.firstElementChild, step * height);
        });
      } else if (section) {
        const siblings = sections.filter(s => s.dataset.dragScope === section.dataset.dragScope);
        // A drop on a header occupies that workspace's position.
        const index = siblings.indexOf(section);
        before = (siblings.indexOf(pending.section) < index ? siblings[index + 1] : section)?.dataset.workspace ?? null;
      }
      for (const node of shifted) if (!shifts.has(node)) { node.style.removeProperty("--drag-shift"); shifted.delete(node); }
      for (const [node, dy] of shifts) { node.style.setProperty("--drag-shift", dy + "px"); shifted.add(node); }
      drop = section || overTrash ? { source, pane: pending.pane, target: section?.dataset.workspace ?? source, before, trash: overTrash } : null;
    }
    function tick() { frameAtPointer(); if (ghost) frame = requestAnimationFrame(tick); }
    function down(e: PointerEvent) {
      if (!e.isPrimary || e.button !== 0 || !(e.target instanceof Element)) return;
      // Only the click generated by the held pointer is suppressed. A fresh tap can restore a group.
      suppress = false;
      const node = e.target.closest<HTMLElement>(".bot-group,.bot-row");
      const section = node?.closest<HTMLElement>("section[data-drag-space]");
      if (!node || !section || node.matches(":disabled,[role=checkbox]")) return;
      clear();
      const pane = node.closest<HTMLElement>("li")?.dataset.dragPane;
      if (node.classList.contains("bot-row") && !pane) return;
      pending = { id: e.pointerId, start: performance.now(), x: e.clientX, y: e.clientY, touch: e.pointerType === "touch", node, section, pane };
      timer = window.setTimeout(() => {
        if (!pending || ghost) return;
        if (!pane) { suppress = true; callbacks.current.onMenu(section.dataset.workspace!); }
        clear();
      }, HOLD);
    }
    function move(x: number, y: number) {
      if (!pending) return;
      clientX = x;
      clientY = y;
      if (ghost || Math.hypot(x - pending.x, y - pending.y) < SLOP) return;
      const elapsed = performance.now() - pending.start;
      if (elapsed >= HOLD || (pending.touch && elapsed < ARM_TOUCH)) { clear(); return; }
      window.clearTimeout(timer);
      suppress = true;
      const rect = pending.node.getBoundingClientRect();
      left = pending.x - rect.left;
      top = pending.y - rect.top;
      const clone = pending.node.cloneNode(true);
      if (!(clone instanceof HTMLElement)) return;
      ghost = clone;
      ghost.classList.add("bot-drag-ghost");
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      ghost.style.width = rect.width + "px";
      shell.appendChild(ghost);
      pending.node.setAttribute("data-lifted", "");
      setDraggingChat(!!pending.pane);
      tick();
    }
    function pointerMove(e: PointerEvent) {
      if (pending?.id === e.pointerId) move(e.clientX, e.clientY);
    }
    function touchMove(e: TouchEvent) {
      if (e.touches.length !== 1) { clear(); return; }
      if (!pending?.touch) return;
      const finger = e.touches[0]!;
      move(finger.clientX, finger.clientY);
      // A non-passive listener on the scrolling element lets Safari retain its normal quick swipe.
      if (ghost && e.cancelable) e.preventDefault();
    }
    function up(e: PointerEvent) {
      if (pending?.id !== e.pointerId) return;
      if (ghost) { clientX = e.clientX; clientY = e.clientY; frameAtPointer(); }
      const result = drop;
      clear();
      if (result) callbacks.current.onDrop(result);
    }
    function click(e: MouseEvent) {
      if (suppress && e.detail !== 0) { e.preventDefault(); e.stopImmediatePropagation(); }
      suppress = false;
    }
    function menu(e: MouseEvent) {
      if (e.target instanceof Element && (ghost || e.target.closest("section[data-drag-space] .bot-group"))) {
        e.preventDefault();
        if (!ghost && e.button === 2) {
          const workspace = e.target.closest("section")!.dataset.workspace!;
          clear(); callbacks.current.onMenu(workspace);
        }
      }
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") clear();
      if (e.target instanceof HTMLElement && e.target.matches("section[data-drag-space] .bot-group") && e.shiftKey && e.key === "F10") {
        e.preventDefault(); callbacks.current.onMenu(e.target.closest("section")!.dataset.workspace!);
      }
    }
    const controller = new AbortController();
    const opts = { signal: controller.signal };
    list.addEventListener("pointerdown", down, opts);
    list.addEventListener("touchmove", touchMove, { ...opts, passive: false });
    list.addEventListener("click", click, { ...opts, capture: true });
    list.addEventListener("contextmenu", menu, opts);
    document.addEventListener("pointermove", pointerMove, opts);
    document.addEventListener("pointerup", up, opts);
    document.addEventListener("pointercancel", clear, opts);
    document.addEventListener("keydown", key, opts);
    window.addEventListener("blur", clear, opts);
    return () => { clear(); controller.abort(); };
  }, [enabled, listRef]);
  return draggingChat;
}
