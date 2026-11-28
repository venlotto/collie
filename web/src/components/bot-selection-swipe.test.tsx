import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BotRow } from "./bot-selection";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const pointer = { button: 0, pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 20, clientY: 50 };
function setup(props: Partial<React.ComponentProps<typeof BotRow>> = {}) {
  const onSwipeRight = vi.fn(), onOpen = vi.fn(), onHold = vi.fn();
  const page = render(<BotRow current={false} onSwipeRight={onSwipeRight} onOpen={onOpen} onHold={onHold} onPress={vi.fn()} {...props}>Bot</BotRow>);
  return { row: page.getByRole(props.checked === undefined ? "button" : "checkbox"), onSwipeRight, onOpen, onHold };
}
it("commits a full right swipe once on release and suppresses its click and long press", () => {
  const { row, onSwipeRight, onOpen, onHold } = setup();
  fireEvent.pointerDown(row, pointer);
  fireEvent.pointerMove(row, { ...pointer, clientX: 140 });
  expect(onSwipeRight).not.toHaveBeenCalled();
  expect(row).toHaveAttribute("data-swipe-ready");
  act(() => vi.advanceTimersByTime(600));
  expect(onHold).not.toHaveBeenCalled();
  fireEvent.pointerUp(row, { ...pointer, clientX: 140 });
  fireEvent.pointerUp(row, { ...pointer, clientX: 140 });
  fireEvent.click(row, { detail: 1 });
  expect(onSwipeRight).toHaveBeenCalledTimes(1);
  expect(onOpen).not.toHaveBeenCalled();
  expect(row).not.toHaveAttribute("data-swiping");
});
it.each([
  ["short", 70, 50], ["left", -100, 50], ["vertical", 30, 180], ["diagonal", 140, 180],
])("does not delete on a %s gesture", (_name, clientX, clientY) => {
  const { row, onSwipeRight } = setup();
  fireEvent.pointerDown(row, pointer);
  fireEvent.pointerMove(row, { ...pointer, clientX, clientY });
  fireEvent.pointerUp(row, { ...pointer, clientX, clientY });
  expect(onSwipeRight).not.toHaveBeenCalled();
});
it.each(["pointerCancel", "blur", "reverse", "second finger"])("cancels a swipe on %s", kind => {
  const { row, onSwipeRight, onOpen } = setup();
  fireEvent.pointerDown(row, pointer);
  fireEvent.pointerMove(row, { ...pointer, clientX: 140 });
  if (kind === "pointerCancel") fireEvent.pointerCancel(row, pointer);
  if (kind === "blur") fireEvent(window, new Event("blur"));
  if (kind === "second finger") fireEvent.pointerDown(row, { ...pointer, pointerId: 2, isPrimary: false });
  if (kind === "reverse") fireEvent.pointerMove(row, { ...pointer, clientX: 40 });
  fireEvent.pointerUp(row, { ...pointer, clientX: kind === "reverse" ? 40 : 140 });
  expect(onSwipeRight).not.toHaveBeenCalled();
  if (kind !== "second finger") { fireEvent.click(row, { detail: 1 }); expect(onOpen).not.toHaveBeenCalled(); }
});
it.each([{ disabled: true }, { checked: false }, { onSwipeRight: undefined }])("does not swipe an unavailable row %j", props => {
  const { row, onSwipeRight } = setup(props);
  fireEvent.pointerDown(row, pointer);
  fireEvent.pointerMove(row, { ...pointer, clientX: 140 });
  fireEvent.pointerUp(row, { ...pointer, clientX: 140 });
  expect(onSwipeRight).not.toHaveBeenCalled();
  expect(row).not.toHaveAttribute("data-swipeable");
});
it("keeps a mouse drag and a stationary long press out of the swipe path", () => {
  const { row, onSwipeRight, onHold } = setup();
  fireEvent.pointerDown(row, { ...pointer, pointerType: "mouse" });
  fireEvent.pointerMove(row, { ...pointer, pointerType: "mouse", clientX: 140 });
  fireEvent.pointerUp(row, { ...pointer, pointerType: "mouse", clientX: 140 });
  fireEvent.pointerDown(row, pointer);
  act(() => vi.advanceTimersByTime(450));
  expect(onHold).toHaveBeenCalledOnce();
  fireEvent.pointerMove(row, { ...pointer, clientX: 140 });
  fireEvent.pointerUp(row, { ...pointer, clientX: 140 });
  expect(onSwipeRight).not.toHaveBeenCalled();
});
