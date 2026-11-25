import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fixtureAgents, fixtureSnapshot } from "@/test/handlers";
import type { AgentView } from "@/lib/types";
import { installApiStub, pinLocale } from "./fixtures/api";

test.use({ serviceWorkers: "block" });

async function setup(page: Page) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const workspaces = ["Kanban agents", "Duck duck race"].map((label, i) => Object.assign({}, fixtureSnapshot.workspaces[0]!, {
    workspaceId: "w" + (i + 1), label,
  }));
  let serial = 5;
  const panes: AgentView[] = ["Orquestador", "Menú y Updates", "Puente OpenBot", "Duck Race"].map((name, i) => {
    const w = workspaces[i < 3 ? 0 : 1]!;
    return Object.assign({}, fixtureAgents[0]!, { paneId: w.workspaceId + ":p" + i, terminalId: "fixture-" + i,
      workspaceId: w.workspaceId, workspaceLabel: w.label, paneLabel: name, focused: i === 0, hasSession: false });
  });
  const writes: string[] = [];
  await page.route(url => url.pathname === "/api/snapshot", route => route.fulfill({ json: {
    ...fixtureSnapshot, bridge: "connected", ts: Date.now(), device: { authorized: true, device: "Campo" },
    agents: panes, shellPanes: [], workspaces,
  } }));
  await page.route(url => url.pathname === "/api/bot-action", async route => {
    const { action, terminalId, workspaceId, trashedAt } = route.request().postDataJSON();
    const pane = panes.find(p => p.terminalId === terminalId)!;
    expect(route.request().method()).toBe("POST");
    writes.push(action);
    if (action === "trash") pane.trash = { trashedAt: Date.now(), originalWorkspaceId: pane.workspaceId };
    if (action === "restore" || action === "purge") expect(trashedAt).toBe(pane.trash?.trashedAt);
    if (action === "restore") delete pane.trash;
    if (action === "purge") panes.splice(panes.indexOf(pane), 1);
    if (workspaceId) {
      const w = workspaces.find(candidate => candidate.workspaceId === workspaceId)!;
      Object.assign(pane, { workspaceId, workspaceLabel: w.label, paneId: workspaceId + ":p" + ++serial });
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await expect(page.locator(".bot-row")).toHaveCount(4);
  function removeOriginalWorkspace() {
    const destination = workspaces[1]!;
    workspaces.shift();
    for (const pane of panes) {
      pane.workspaceId = destination.workspaceId;
      pane.workspaceLabel = destination.label;
    }
  }
  return { writes, removeOriginalWorkspace };
}

async function hold(page: Page, row: Locator) {
  const box = (await row.boundingBox())!;
  if (test.info().project.name.includes("webkit")) {
    // WebKit's public touchscreen API exposes tap only. Send its touch pointer sequence,
    // including the compatibility click Safari emits on release.
    const touch = { pointerType: "touch", pointerId: 7, isPrimary: true, button: 0,
      clientX: box.x + 30, clientY: box.y + box.height / 2 };
    await row.dispatchEvent("pointerdown", { ...touch, buttons: 1 });
    await expect(row).toHaveAttribute("aria-checked", "true");
    await row.dispatchEvent("pointerup", { ...touch, buttons: 0 });
    await row.dispatchEvent("click", { detail: 1 });
    return;
  }
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  await expect(row).toHaveAttribute("aria-checked", "true");
  await page.mouse.up();
}

async function capture(page: Page, name: string) {
  const dir = process.env.BOT_SCREENSHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, test.info().project.name + "-" + name + ".png") });
}

const named = (page: Page, name: string) => page.locator(".bot-row").filter({ hasText: name });

test("mantener pulsado, alternar, seleccionar todo y mover dos chats", async ({ page }) => {
  const { writes } = await setup(page);
  const first = named(page, "Orquestador"), second = named(page, "Menú");
  const search = page.getByRole("searchbox");
  const footer = (await search.locator("..").boundingBox())!;
  await capture(page, "lista");
  await hold(page, first);
  await expect(page.getByText("1 seleccionado")).toBeVisible();
  const toolbar = page.getByRole("toolbar", { name: "Acciones de selección" });
  const bounds = (await toolbar.boundingBox())!;
  expect(Math.abs(bounds.y + bounds.height - footer.y - footer.height)).toBeLessThan(.5);
  await capture(page, "seleccion-uno");
  await hold(page, second);
  await expect(page.getByText("2 seleccionados")).toBeVisible();
  await second.click();
  await expect(second).not.toBeChecked();
  await page.getByRole("button", { name: "Seleccionar todo" }).click();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(4);
  await page.getByRole("button", { name: "Listo" }).click();
  await expect(search).toBeVisible();
  if (test.info().project.name.includes("desktop")) await first.click({ button: "right" });
  else await hold(page, first);
  await second.click();
  await expect(page.getByText("2 seleccionados")).toBeVisible();
  await capture(page, "seleccion-varios");
  if (process.env.BOT_SCREENSHOTS) await toolbar.screenshot({ path: join(process.env.BOT_SCREENSHOTS, test.info().project.name + "-barra.png") });
  await toolbar.getByRole("button", { name: "Mover" }).click();
  const sheet = page.getByRole("dialog", { name: "Mover a" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".bot-sheet")).toHaveCSS("transform", "none");
  await capture(page, "sheet-mover");
  await sheet.getByRole("button", { name: "Duck duck race" }).click();
  const target = page.locator("section").filter({ has: page.getByRole("button", { name: "Duck duck race", exact: true }) });
  await expect(target.locator(".bot-row")).toHaveCount(3);
  await expect(target.locator(".bot-row").filter({ hasText: "Orquestador" })).toBeVisible();
  expect(writes).toEqual(["move", "move"]);
  await expect(sheet).toHaveCount(0);
  await hold(page, first);
  await page.getByRole("toolbar").getByRole("button", { name: "Eliminar" }).click();
  await expect(page.locator('section[data-workspace="trash"] .bot-row')).toHaveCount(1);
  expect(writes.at(-1)).toBe("trash");
});

test("un solo chat va a papelera, se restaura y sólo se cierra al confirmar", async ({ page }) => {
  const { writes } = await setup(page);
  const row = named(page, "Orquestador");
  const remove = page.getByRole("toolbar").getByRole("button", { name: "Eliminar" });
  const trash = page.locator('section[data-workspace="trash"]');
  await hold(page, row);
  await remove.click();
  await expect(trash.locator(".bot-row")).toHaveText(/Orquestador.*Se elimina en 7 días/);
  await page.reload();
  await expect(trash.locator(".bot-row")).toBeVisible();
  await capture(page, "papelera");
  await trash.locator(".bot-row").click();
  await page.getByRole("button", { name: "Restaurar" }).click();
  await expect(trash).toHaveCount(0);
  await expect(page.locator("section").filter({ hasText: "Kanban agents" }).locator(".bot-row").filter({ hasText: "Orquestador" })).toBeVisible();
  await hold(page, row);
  await remove.click();
  await trash.locator(".bot-row").click();
  await remove.click();
  const confirm = page.getByRole("dialog", { name: "Eliminar definitivamente" });
  await expect(confirm).toBeVisible();
  await expect(confirm.locator(".bot-sheet")).toHaveCSS("transform", "none");
  await capture(page, "confirmacion");
  await confirm.getByRole("button", { name: "Cancelar" }).click();
  await expect(confirm).toHaveCount(0);
  expect(writes).toEqual(["trash", "restore", "trash"]);
  await remove.click();
  await page.getByRole("button", { name: "Eliminar definitivamente", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(page.locator(".bot-row")).toHaveCount(3);
  expect(writes.at(-1)).toBe("purge");
});

test("restaurar permite elegir destino si desapareció el workspace original", async ({ page }) => {
  const fixture = await setup(page);
  await hold(page, named(page, "Orquestador"));
  await page.getByRole("toolbar").getByRole("button", { name: "Eliminar" }).click();
  const trash = page.locator('section[data-workspace="trash"]');
  await expect(trash).toBeVisible();
  fixture.removeOriginalWorkspace();
  await page.reload();
  await trash.locator(".bot-row").click();
  await page.getByRole("button", { name: "Restaurar" }).click();
  await page.getByRole("dialog", { name: "Restaurar en" }).getByRole("button", { name: "Duck duck race" }).click();
  await expect(trash).toHaveCount(0);
  await expect(named(page, "Orquestador")).toBeVisible();
  expect(fixture.writes).toEqual(["trash", "restore"]);
});
