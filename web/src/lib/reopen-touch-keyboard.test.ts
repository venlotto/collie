import { afterEach, expect, it, vi } from "vitest";
import { reopenTouchKeyboard } from "./reopen-touch-keyboard";
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
it("requests fresh focus synchronously while preserving the draft and selection", () => {
  const field = document.createElement("textarea");
  document.body.append(field);
  field.value = "Mi mensaje";
  field.focus();
  field.setSelectionRange(1, 4);
  const blur = vi.spyOn(field, "blur");
  reopenTouchKeyboard(field, "touch", false);
  expect(blur).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(field);
  expect(field.value).toBe("Mi mensaje");
  expect([field.selectionStart, field.selectionEnd]).toEqual([1, 4]);
});
it("leaves an open keyboard, mouse selection and read-only fields alone", () => {
  const field = document.createElement("textarea");
  document.body.append(field);
  field.focus();
  const blur = vi.spyOn(field, "blur");
  reopenTouchKeyboard(field, "touch", true);
  reopenTouchKeyboard(field, "mouse", false);
  field.readOnly = true;
  reopenTouchKeyboard(field, "touch", false);
  expect(blur).not.toHaveBeenCalled();
});
