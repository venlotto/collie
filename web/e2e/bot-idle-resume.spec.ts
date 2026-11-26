import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { fixtureAgents, fixtureSnapshot } from "@/test/handlers";
import { installApiStub, pinLocale } from "./fixtures/api";

test.use({ serviceWorkers: "block" });

const unattended = 31 * 60_000;
const pollWindow = 15_000;
const resumeCopy = /^(Tap to resume|Pulsa para reanudar|Paused|En pausa|Catching up|Sincronizando)[….]*$/i;

async function expectNoPrompt(page: Page) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(resumeCopy)).toHaveCount(0);
}

async function capture(page: Page, state: string) {
  const dir = process.env.BOT_SCREENSHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, test.info().project.name + "-" + state + ".png") });
}

async function geometry(page: Page) {
  const list = page.locator(".bot-scroll");
  return {
    list: await list.boundingBox(),
    scroll: await list.evaluate(el => el.scrollTop),
    search: await page.getByRole("searchbox").boundingBox(),
  };
}

for (const wake of ["gesture", "visibility"] as const) {
  test(`visible idle pauses polling and animations, then ${wake} refreshes the same list in place`, async ({ page, isMobile }) => {
    await page.clock.install();
    await pinLocale(page, isMobile ? "es" : "en");
    await installApiStub(page);

    const workspace = { ...fixtureSnapshot.workspaces[0]!, label: "Equipo de prueba" };
    const agents = Array.from({ length: 18 }, (_, i) => ({
      ...fixtureAgents[0]!, workspaceLabel: workspace.label, paneId: "w1:p" + i,
      paneLabel: "Chat " + (i + 1), terminalId: "fixture-" + i,
    }));
    let reads = 0;
    let refreshes = 0;
    let holdSnapshot: Promise<void> | undefined;
    await page.route(url => url.pathname === "/api/snapshot", async route => {
      reads++;
      await holdSnapshot;
      await route.fulfill({ json: {
        ...fixtureSnapshot, agents, workspaces: [workspace], shellPanes: [], ts: Date.now(),
        device: { enforced: true, authorized: true, device: "Prueba" },
      } });
    });
    await page.route(url => url.pathname === "/api/refresh", async route => {
      refreshes++;
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto("/");
    const search = page.getByRole("searchbox");
    const list = page.locator(".bot-scroll");
    const anchor = page.getByText("Chat 6", { exact: true });
    await expect(anchor).toBeVisible();
    await list.evaluate(el => { el.scrollTop = 128; });
    const before = await geometry(page);
    expect(before.scroll).toBe(128);
    const original = await list.elementHandle();
    const beforePoll = reads;
    await page.clock.fastForward(pollWindow);
    await expect.poll(() => reads).toBeGreaterThan(beforePoll);

    await page.clock.fastForward(unattended);
    await expectNoPrompt(page);
    await expect(search).toHaveCSS("animation-play-state", "paused");
    expect(await geometry(page)).toEqual(before);
    await page.waitForLoadState("networkidle");
    const pausedReads = reads;
    const pausedRefreshes = refreshes;
    await page.clock.fastForward(pollWindow);
    await page.waitForLoadState("networkidle");
    expect(reads).toBe(pausedReads);
    if (wake === "gesture") await capture(page, "idle");

    agents[5]!.paneLabel = "Chat 6 actualizado";
    let release!: () => void;
    holdSnapshot = new Promise<void>(resolve => { release = resolve; });
    try {
      if (wake === "gesture") {
        if (isMobile) await search.tap();
        else await search.click();
        await expect(search).toBeFocused();
      } else {
        // Playwright has no portable headless background-tab API across these two engines.
        await page.evaluate(() => {
          for (const hidden of [true, false]) {
            Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
            Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" });
            document.dispatchEvent(new Event("visibilitychange"));
          }
        });
      }
      // No timer advance: both the snapshot and the bridge census must start on the wake itself.
      await expect.poll(() => refreshes, { timeout: 2000 }).toBeGreaterThan(pausedRefreshes);
      await expect.poll(() => reads, { timeout: 2000 }).toBeGreaterThan(pausedReads);
      await expect(search).toHaveCSS("animation-play-state", "running");
      await expect(anchor).toBeVisible();
      await expectNoPrompt(page);
      expect(await geometry(page)).toEqual(before);
    } finally {
      holdSnapshot = undefined;
      release();
    }
    await expect(page.getByText("Chat 6 actualizado", { exact: true })).toBeVisible();
    expect(await original.evaluate(el => el.isConnected)).toBe(true);
    expect(await geometry(page)).toEqual(before);
    if (wake === "gesture") await capture(page, "reanudado");
    const resumedReads = reads;
    await page.clock.fastForward(pollWindow);
    await expect.poll(() => reads).toBeGreaterThan(resumedReads);
  });
}
