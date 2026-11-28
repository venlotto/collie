import { useRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useBotListSelection } from "./use-bot-list-selection";

function Fixture({ inert = false }: { inert?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useBotListSelection(ref);
  return <><p>Conversation text</p><aside inert={inert}>
    <div ref={ref}><button>Workspace</button><div role="dialog"><button>Delete workspace</button><input aria-label="Name" defaultValue="Ideas" /></div></div>
  </aside></>;
}
function select(node: Node) {
  window.getSelection()!.selectAllChildren(node);
  document.dispatchEvent(new Event("selectionchange"));
}
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); });

it("clears a selection spanning the whole list and action sheet", () => {
  const page = render(<Fixture />);
  select(page.container);
  expect(window.getSelection()!.rangeCount).toBe(0);
  select(page.getByRole("dialog"));
  expect(window.getSelection()!.rangeCount).toBe(0);
  expect(fireEvent(page.getByRole("button", { name: "Workspace" }), new Event("selectstart", { bubbles: true, cancelable: true }))).toBe(false);
});

it("leaves conversation text and input selection alone", () => {
  const page = render(<Fixture />);
  select(page.getByText("Conversation text"));
  expect(window.getSelection()!.toString()).toBe("Conversation text");
  const field = page.getByRole("textbox", { name: "Name" });
  if (!(field instanceof HTMLInputElement)) throw new Error("Expected the name input");
  field.focus();
  field.setSelectionRange(0, 5);
  expect(fireEvent(field, new Event("selectstart", { bubbles: true, cancelable: true }))).toBe(true);
  document.dispatchEvent(new Event("selectionchange"));
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, 5]);
});

it("does not let the hidden sidebar clear selection in an open chat", () => {
  const page = render(<Fixture inert />);
  select(page.container);
  expect(window.getSelection()!.toString()).toContain("Conversation text");
});
