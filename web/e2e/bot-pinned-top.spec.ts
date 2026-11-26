import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot } from "@/test/handlers";
import type { AgentView } from "@/lib/types";
import type { BotFeaturedPin } from "@/lib/bot-featured-wire";
import { installApiStub, installPaneWorld, pinLocale } from "./fixtures/api";

const expect = baseExpect.configure({ timeout: 15_000 });
test.use({ serviceWorkers: "block" });

function pinOf(pane: AgentView): BotFeaturedPin {
  return { row: [pane.host ?? "", pane.session ?? "", pane.paneId].join("\u0000"), space: pane.workspaceLabel, at: Date.now() };
}

async function shot(page: Page, name: string) {
  const dir = process.env.BOT_SCREENSHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  const device = test.info().project.name === "phone-webkit" ? "iphone-webkit" : "desktop";
  await page.screenshot({ path: join(dir, device + "-" + name + ".png"), scale: "css", animations: "disabled" });
}

async function hold(page: Page, row: Locator) {
  const box = (await row.boundingBox())!;
  const point = { clientX: box.x + 30, clientY: box.y + box.height / 2 };
  if (test.info().project.name.includes("webkit")) {
    const touch = { pointerType: "touch", pointerId: 7, isPrimary: true, button: 0, ...point };
    await row.dispatchEvent("pointerdown", { ...touch, buttons: 1 });
    await expect(row).toHaveAttribute("aria-checked", "true");
    await row.dispatchEvent("pointerup", { ...touch, buttons: 0 });
    await row.dispatchEvent("click", { detail: 1 });
    return;
  }
  await page.mouse.move(point.clientX, point.clientY);
  await page.mouse.down();
  await expect(row).toHaveAttribute("aria-checked", "true");
  await page.mouse.up();
}

async function setup(page: Page) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const agents = ["Alfa", "Beta"].map((name, i) => Object.assign({}, fixtureAgents[i]!, { paneLabel: name, hasSession: true,
    terminalId: "featured-" + String(i), focused: i === 1, status: "idle" as const }));
  const snapshot = { ...fixtureSnapshot, agents, shellPanes: [], ts: Date.now(),
    device: { authorized: true, enforced: true, device: "Campo" } };
  let featured: BotFeaturedPin | null = null;
  await page.route("**/api/bot-featured", async route => {
    if (route.request().method() === "PUT") {
      // SAFETY: the app's requestBotFeatured is the only writer in this isolated browser world.
      featured = (route.request().postDataJSON() as { featured: BotFeaturedPin | null }).featured;
    }
    await route.fulfill({ json: { userId: "local", featured } });
  });
  for (const agent of agents) {
    await installPaneWorld(page, { paneId: agent.paneId, snapshot, chat: fixtureKiroChat,
      screens: { idle: "› Ask the fixture bot anything" }, start: "idle" });
  }
  return { agents, snapshot, featured: () => featured,
    setFeatured: (next: BotFeaturedPin | null) => { featured = next; } };
}

async function openChat(page: Page, name: string) {
  await page.locator(".bot-row").filter({ hasText: name }).click();
  await expect(page.getByRole("button", { name: "Opciones del chat" })).toBeVisible();
}

async function changePin(page: Page, label: "Fijar chat" | "Desfijar chat") {
  await page.getByRole("button", { name: "Opciones del chat" }).click();
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function backToList(page: Page) {
  await page.getByRole("button", { name: "Volver a los chats" }).click();
  await expect(page.locator(".bot-index")).toBeVisible();
  if (test.info().project.name.includes("phone")) await expect(page.locator(".bot-layout")).toHaveAttribute("data-detail", "false");
}

test("sólo el chat pineado ocupa el hueco: A, B, recarga, búsqueda, selección y desfijar", async ({ page }) => {
  const world = await setup(page);
  await page.goto("/");
  const featured = page.locator(".bot-featured");
  await expect(page.locator(".bot-row")).toHaveCount(2);
  await expect(featured).toHaveCount(0); // Beta is focused, but focus earns no slot.
  await shot(page, "sin-pin");

  await openChat(page, "Alfa");
  await changePin(page, "Fijar chat");
  await expect.poll(() => world.featured()?.row).toBe(pinOf(world.agents[0]!).row);
  await backToList(page);
  await expect(featured).toHaveText("Alfa");
  await expect(featured).toBeVisible();
  await expect(featured).toHaveJSProperty("offsetHeight", 84);
  await expect(page.locator(".bot-row")).toHaveCount(2);
  await shot(page, "pin-a");

  await openChat(page, "Beta");
  await changePin(page, "Fijar chat");
  await expect.poll(() => world.featured()?.row).toBe(pinOf(world.agents[1]!).row);
  await backToList(page);
  await expect(featured).toHaveText("Beta");
  await expect(featured).toBeVisible();
  await expect(page.locator(".bot-row")).toHaveCount(2);
  await shot(page, "pin-b-sustituye-a");

  await page.reload();
  await expect(featured).toHaveText("Beta");
  await expect(featured).toBeVisible();
  await page.getByRole("searchbox", { name: "Buscar" }).fill("Beta");
  await expect(featured).toHaveCount(0);
  await shot(page, "busqueda-sin-hueco");
  await page.getByRole("searchbox", { name: "Buscar" }).fill("");
  await expect(featured).toHaveText("Beta");
  await expect(featured).toBeVisible();

  await hold(page, page.locator(".bot-row").first());
  await expect(featured).toBeDisabled();
  await shot(page, "multiseleccion-deshabilita");
  await page.getByRole("button", { name: "Listo" }).click();
  await expect(featured).toBeEnabled();

  await featured.click(); // The featured card opens the same chat as its ordinary row.
  await expect(page.getByRole("button", { name: "Opciones del chat" })).toBeVisible();
  await changePin(page, "Desfijar chat");
  await expect.poll(() => world.featured()).toBeNull();
  await backToList(page);
  await expect(featured).toHaveCount(0);
  await expect(page.locator(".bot-row")).toHaveCount(2);
  await expect(page.locator(".bot-row").first()).toBeVisible();
  await shot(page, "desfijado");
});

test("otro dispositivo recibe el pin y la papelera lo retira sin borrar la fila recuperable", async ({ page, browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const world = await setup(page);
  world.setFeatured(pinOf(world.agents[0]!));
  await page.goto("/");
  await expect(page.locator(".bot-featured")).toHaveText("Alfa");

  const fresh = await browser.newPage({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor, serviceWorkers: "block" });
  try {
    const peer = await setup(fresh);
    peer.setFeatured(world.featured());
    await fresh.goto("/");
    await expect(fresh.locator(".bot-featured")).toHaveText("Alfa");
    await shot(fresh, "otro-dispositivo");
  } finally {
    await fresh.close();
  }

  await hold(page, page.locator(".bot-row").filter({ hasText: "Alfa" }));
  await page.route("**/api/bot-action", async route => {
    // SAFETY: the list's actOnBot is the only writer in this isolated browser world.
    const { terminalId } = route.request().postDataJSON() as { terminalId: string };
    const pane = world.agents.find(candidate => candidate.terminalId === terminalId);
    if (pane) pane.trash = { trashedAt: Date.now(), originalWorkspaceId: pane.workspaceId };
    await route.fulfill({ json: { ok: true } });
  });
  await page.getByRole("toolbar", { name: "Acciones de selección" }).getByRole("button", { name: "Eliminar" }).click();
  await expect(page.locator(".bot-featured")).toHaveCount(0);
  await expect.poll(() => world.featured()).toBeNull();
  await expect(page.locator('section[data-workspace="trash"] .bot-row')).toHaveText(/Alfa/);
});
