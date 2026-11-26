import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fixtureAgents, fixtureSnapshot } from "@/test/handlers";
import { installApiStub, pinLocale } from "./fixtures/api";

test.use({ serviceWorkers: "block" });

type Frame = Record<string, string | null>;
declare global {
  interface Window { sectionFrames: Frame[] }
}

// Start at document creation so a frame of expanded rows is recorded even when
// the final Playwright locator already sees the right answer.
async function watchFrames(page: Page) {
  await page.addInitScript(() => {
    const frames: Frame[] = [];
    window.sectionFrames = frames;
    function sample() {
      const groups = [...document.querySelectorAll(".bot-group")].filter(button => button.getClientRects().length);
      if (groups.length) {
        frames.push(Object.fromEntries(groups.map(button =>
          [button.textContent, button.getAttribute("aria-expanded")])));
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
}

async function capture(page: Page, label: string, frames?: Frame[]) {
  const dir = process.env.BOT_SCREENSHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  const file = join(dir, test.info().project.name + "-" + label);
  await page.screenshot({ path: file + ".png", animations: "disabled" });
  if (frames) await writeFile(file + ".json", JSON.stringify(frames, null, 2));
}

const workspace = "Proyectos";
const trash = "Papelera";
const added = "Ideas nuevas";

async function checkFirstFrame(page: Page, label: string, trashExpanded = false) {
  await expect(page.locator(".bot-index")).toBeVisible({ timeout: 30_000 });
  const expected = [[workspace, "false"], [trash, String(trashExpanded)], [added, "true"]] as const;
  for (const [name, expanded] of expected) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-expanded", expanded);
  }
  await expect(page.locator(".bot-row").filter({ hasText: "Idea del día" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.sectionFrames.length)).toBeGreaterThan(1);
  const frames = await page.evaluate(() => window.sectionFrames);
  for (const [name, expanded] of expected) {
    const rendered = frames.filter(frame => name in frame);
    expect(rendered.length, name).toBeGreaterThan(0);
    expect([...new Set(rendered.map(frame => frame[name]))], name).toEqual([expanded]);
  }
  await capture(page, label, frames);
}

test("recuerda cada acordeón desde el primer frame al recargar y en otro dispositivo", async ({
  page, browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor,
}) => {
  test.slow(); // Four navigations across two isolated browser contexts.
  const folded = new Set<string>();
  let newWorkspace = false;
  let unavailable = false;
  const groups = [
    { id: "w1", name: workspace, bot: "Plan de la semana" },
    { id: "w2", name: "Equipo", bot: "Agenda del equipo" },
    { id: "w3", name: added, bot: "Idea del día" },
  ];
  async function install(device: Page) {
    await pinLocale(device, "es");
    await installApiStub(device);
    await watchFrames(device);
    await device.route("**/api/snapshot*", route => {
      const visible = groups.slice(0, newWorkspace ? 3 : 2);
      const workspaces = visible.map(({ id, name }) =>
        Object.assign({}, fixtureSnapshot.workspaces[0]!, { workspaceId: id, label: name }));
      const agents = visible.map(({ id, name, bot }) => Object.assign({}, fixtureAgents[0]!, {
        workspaceId: id, workspaceLabel: name, paneLabel: bot,
        paneId: id + ":p1", terminalId: "test-" + id, hasSession: false,
      }));
      const removed = { ...agents[0]!, paneId: "w1:p2", terminalId: "test-removed", paneLabel: "Borrador",
        trash: { trashedAt: Date.now(), originalWorkspaceId: "w1" } };
      return route.fulfill({ json: { ...fixtureSnapshot, agents: [...agents, removed], workspaces, shellPanes: [],
        device: { authorized: true, device: "Campo", enforced: true }, ts: Date.now() } });
    });
    await device.route("**/api/ui-sections", async route => {
      if (device === page && unavailable) return route.fulfill({ status: 503, json: { error: "offline" } });
      if (route.request().method() === "PUT") {
        // SAFETY: the app’s requestBotSections is the only writer in this isolated context.
        const { changes } = route.request().postDataJSON() as { changes: Record<string, boolean> };
        for (const [key, closed] of Object.entries(changes)) {
          if (closed) folded.add(key);
          else folded.delete(key);
        }
      } else {
        // Leave time for a stale cache to paint if the list races the authenticated response.
        await delay(150);
      }
      return route.fulfill({ json: { userId: "local", folded: [...folded] } });
    });
  }
  await install(page);
  await page.goto("/");
  await expect(page.locator(".bot-index")).toBeVisible({ timeout: 30_000 });
  for (const name of [workspace, trash]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "false");
  }
  const spaceKey = await page.getByRole("button", { name: workspace, exact: true }).locator("..").getAttribute("data-workspace");
  await expect.poll(() => new Set(folded)).toEqual(new Set([spaceKey, "trash"]));
  await capture(page, "plegados");

  // A warm device can reload from its own cache even if only the preference API is down.
  newWorkspace = true;
  unavailable = true;
  await page.reload();
  await checkFirstFrame(page, "recarga");

  unavailable = false;
  await page.getByRole("button", { name: trash, exact: true }).click();
  await expect.poll(() => folded.has("trash")).toBe(false);

  // A new storage partition has never seen these workspaces. Only the shared server
  // can tell it which workspace is folded and that trash was reopened.
  const fresh = await browser.newPage({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor, serviceWorkers: "block" });
  try {
    await install(fresh);
    await fresh.goto("/");
    await checkFirstFrame(fresh, "otro-dispositivo", true);
    unavailable = true; // The original device misses this update while away.
    await fresh.getByRole("button", { name: trash, exact: true }).click();
    await expect.poll(() => folded.has("trash")).toBe(true);
  } finally {
    await fresh.close();
  }
  // The original device now has an obsolete cache. Reopening shows the other device’s tap
  // from the first frame with a visible trash header.
  await page.bringToFront();
  await expect(page.getByRole("button", { name: trash, exact: true })).toHaveAttribute("aria-expanded", "true");
  page.once("framenavigated", () => { unavailable = false; });
  await page.reload();
  await checkFirstFrame(page, "cambio-remoto");
});
