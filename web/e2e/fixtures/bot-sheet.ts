import { expect, type Locator } from "@playwright/test";

export async function expectBotSheetPosition(dialog: Locator) {
  const panel = dialog.locator(".bot-sheet");
  await expect(panel).toHaveCSS("transform", "none");
  const box = (await panel.boundingBox())!;
  const { width, height } = dialog.page().viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(1);
  if (width >= 768) {
    expect(Math.abs(box.y + box.height / 2 - height / 2)).toBeLessThan(1);
  } else {
    const bottomInset = await dialog.evaluate(el => parseFloat(getComputedStyle(el).paddingBottom));
    expect(Math.abs(height - box.y - box.height - bottomInset)).toBeLessThan(1);
  }
}
