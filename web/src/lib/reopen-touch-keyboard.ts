/** Android can keep the caret after dismissing the keyboard. Request fresh native focus inside
 * the next touch, while the browser still allows opening the keyboard. Leave cursor placement
 * to the native pointer default; never prevent it or move the caret to the end. */
export function reopenTouchKeyboard(field: HTMLTextAreaElement, pointerType: string, keyboardOpen: boolean) {
  if (pointerType !== "touch" || keyboardOpen || field.disabled || field.readOnly || document.activeElement !== field) return;
  const start = field.selectionStart, end = field.selectionEnd, direction = field.selectionDirection;
  field.blur();
  field.focus({ preventScroll: true });
  field.setSelectionRange(start, end, direction);
}
