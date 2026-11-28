import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixtureAgents, fixtureSnapshot } from "@/test/handlers";
import type { AgentView } from "@/lib/types";
import { installApiStub, pinLocale } from "./fixtures/api";

test.use({ serviceWorkers: "block" });
async function world(page: Page) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const agents: AgentView[] = ["Bot local", "Bot externo", "Otro bot"].map((name, i) => Object.assign({}, fixtureAgents[0]!, {
    paneId: "swipe-" + i, paneLabel: name, terminalId: "swipe-term-" + i, hasSession: false,
  }));
  delete agents[1]!.terminalId;
  agents[1]!.agentRun = { id: "external", rootId: "external", status: "done", start: Date.now(), end: Date.now() };
  const writes: unknown[] = [];
  await page.route("**/api/snapshot*", r => r.fulfill({ json: { ...fixtureSnapshot, agents, shellPanes: [], ts: Date.now(),
    device: { enforced: true, authorized: true, device: "Prueba" } } }));
  await page.route("**/api/bot-action*", r => { writes.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Bot externo/ })).toBeVisible();
  return { writes };
}

async function swipe(page: Page, row: Locator, browser: string, distance: number, pause = false, cancel = false) {
  await expect(row).toHaveCSS("transform", "none");
  const box = (await row.boundingBox())!;
  const x = box.x + 24, y = box.y + box.height / 2;
  if (browser === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    if (pause) await page.waitForTimeout(180);
    for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + distance * i / 6, y }] });
    if (distance >= 96) {
      await expect(row).toHaveAttribute("data-swipe-ready");
      await expect(page.locator(".bot-drag-ghost")).toHaveCount(0);
      const moved = (await row.boundingBox())!;
      expect(moved.x).toBeGreaterThan(box.x + 90);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
    await cdp.detach();
  } else {
    // WebKit's Playwright touchscreen has tap only: drive its touch-pointer path and actual layout.
    const touch = { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y };
    await row.dispatchEvent("pointerdown", touch);
    if (pause) await page.waitForTimeout(180);
    await row.dispatchEvent("pointermove", { ...touch, clientX: x + distance });
    if (distance >= 96) await expect(row).toHaveAttribute("data-swipe-ready");
    await row.dispatchEvent(cancel ? "pointercancel" : "pointerup", { ...touch, clientX: x + distance, buttons: 0 });
    await row.dispatchEvent("click", { detail: 1 });
  }
}

test("right swipes trash local and external bots without opening or reordering them", async ({ page, browserName }) => {
  const { writes } = await world(page);
  await swipe(page, page.getByRole("button", { name: /^Bot local/ }), browserName, 130, true);
  await expect.poll(() => writes).toEqual([{ action: "trash", terminalId: "swipe-term-0" }]);
  await expect(page.getByRole("searchbox", { name: "Buscar" })).toBeVisible();
  await swipe(page, page.getByRole("button", { name: /^Bot externo/ }), browserName, 130);
  await expect.poll(() => writes).toEqual([{ action: "trash", terminalId: "swipe-term-0" }, { action: "trash", runId: "external" }]);
  await expect(page.getByRole("searchbox", { name: "Buscar" })).toBeVisible();
  expect(await page.locator("body").evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
});

test("short and cancelled touch gestures leave the bot in place", async ({ page, browserName }) => {
  const { writes } = await world(page);
  const row = page.getByRole("button", { name: /^Bot externo/ });
  await swipe(page, row, browserName, 45);
  await expect(row).not.toHaveAttribute("data-swiping");
  await swipe(page, row, browserName, 130, false, true);
  await expect(row).not.toHaveAttribute("data-swiping");
  expect(writes).toEqual([]);
  await expect(page.getByRole("searchbox", { name: "Buscar" })).toBeVisible();
});
