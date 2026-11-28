import { useLayoutEffect, type RefObject } from "react";

const EDITABLE = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

function editable(node: Node | null): boolean {
  const element = node instanceof Element ? node : node?.parentElement;
  return !!element?.closest(EDITABLE);
}

/** List actions own a hold, including when Safari extends a selection over the opened sheet.
 * CSS prevents new selections; this also clears a native selection that already spans the list.
 * The search/name fields and selections confined to a conversation keep their normal behavior. */
export function useBotListSelection(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    function available() {
      const root = ref.current;
      return root?.isConnected && !root.closest("[inert]") ? root : null;
    }
    function clearSelection() {
      const root = available();
      const selection = window.getSelection();
      if (!root || !selection || selection.isCollapsed || editable(document.activeElement) ||
          editable(selection.anchorNode) || editable(selection.focusNode)) return;
      for (let i = 0; i < selection.rangeCount; i++) {
        if (selection.getRangeAt(i).intersectsNode(root)) {
          selection.removeAllRanges();
          return;
        }
      }
    }
    function preventSelection(event: Event) {
      const root = available();
      if (root && event.target instanceof Node && root.contains(event.target) && !editable(event.target)) {
        event.preventDefault();
        clearSelection();
      }
    }
    document.addEventListener("selectstart", preventSelection, true);
    document.addEventListener("selectionchange", clearSelection);
    clearSelection();
    return () => {
      document.removeEventListener("selectstart", preventSelection, true);
      document.removeEventListener("selectionchange", clearSelection);
    };
  }, [ref]);
}
