import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fixtureAgents, fixtureSnapshot } from "@/test/handlers";
import { installApiStub, pinLocale } from "./fixtures/api";

test.use({ serviceWorkers: "block" });

async function world(page: Page) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const spaces = ["Ideas", "Viajes", "Lecturas"].map((label, i) => Object.assign({}, fixtureSnapshot.workspaces[0]!, {
    label, workspaceId: "fixture-" + i, number: i + 1,
  }));
  const agents = ["Bocetos", "Notas", "Rutas", "Mapas", "Libros"].map((paneLabel, i) => {
    const w = spaces[Math.floor(i / 2)]!;
    const paneId = "fixture-chat-" + i;
    return Object.assign({}, fixtureAgents[0]!, { paneLabel, paneId, terminalId: paneId, workspaceId: w.workspaceId,
      workspaceLabel: w.label, hasSession: false, hint: "Conversación de prueba", focused: i === 0 });
  });
  const orders = new Map<string, string[]>();
  const writes: string[] = [];
  const trash: string[] = [];
  await page.route("**/api/snapshot*", r => r.fulfill({ json: { ...fixtureSnapshot, agents, workspaces: spaces,
    shellPanes: [], ts: Date.now(), device: { enforced: true, authorized: true, device: "Prueba" } } }));
  await page.route("**/api/chat-order*", r => {
    if (r.request().method() === "GET") return r.fulfill({ json: Array.from(orders, ([workspaceId, paneIds]) => ({ workspaceId, paneIds })) });
    const { workspaceId, paneId, before } = r.request().postDataJSON();
    const live = agents.filter(p => p.workspaceId === workspaceId).map(p => p.paneId);
    expect(live).toContain(paneId);
    const ids = [...new Set([...(orders.get(workspaceId) ?? []), ...live])].filter(id => id !== paneId && live.includes(id));
    if (before !== null) expect(ids).toContain(before);
    ids.splice(before === null ? ids.length : ids.indexOf(before), 0, paneId);
    orders.set(workspaceId, ids); writes.push("order");
    return r.fulfill({ json: { workspaceId, paneIds: ids } });
  });
  await page.route(/\/api\/space\/fixture-\d+\/(move|rename)$/, r => {
    const [, id, action] = r.request().url().match(/space\/(fixture-\d+)\/(move|rename)$/)!;
    const item = spaces.find(s => s.workspaceId === id)!;
    const body = r.request().postDataJSON();
    if (action === "move") {
      spaces.splice(spaces.indexOf(item), 1);
      spaces.splice(body.before === null ? spaces.length : spaces.findIndex(s => s.workspaceId === body.before), 0, item);
      spaces.forEach((s, i) => { s.number = i + 1; });
    } else {
      item.label = body.label;
      agents.filter(p => p.workspaceId === id).forEach(p => { p.workspaceLabel = body.label; });
    }
    writes.push(action!);
    return r.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/bot-action*", r => {
    const { action, terminalId, workspaceId } = r.request().postDataJSON();
    const target = spaces.find(w => w.workspaceId === workspaceId);
    if (action === "trashWorkspace") {
      expect(target).toBeTruthy();
      spaces.splice(spaces.indexOf(target!), 1);
      for (const p of agents.filter(candidate => candidate.workspaceId === workspaceId)) agents.splice(agents.indexOf(p), 1);
    } else {
      const p = agents.find(candidate => candidate.terminalId === terminalId)!;
      expect(p).toBeTruthy();
      if (action === "trash") { agents.splice(agents.indexOf(p), 1); trash.push(terminalId); }
      else { p.workspaceId = target!.workspaceId; p.workspaceLabel = target!.label; }
    }
    writes.push(action);
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await expect(page.locator(".bot-row")).toHaveCount(5);
  return { writes, trash };
}

async function point(el: Locator, fraction = .5) {
  const box = (await el.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height * fraction };
}

async function gesture(page: Page, source: Locator) {
  const phone = test.info().project.name.includes("webkit");
  const start = await point(source);
  // Playwright's WebKit touchscreen exposes tap only. Exercise the touch pointer path in that
  // engine; Chromium desktop uses trusted mouse input throughout.
  async function send(type: "pointerdown" | "pointermove" | "pointerup", xy: typeof start) {
    if (phone) return source.dispatchEvent(type, { pointerId: 8, isPrimary: true, button: 0,
      buttons: type === "pointerup" ? 0 : 1, pointerType: "touch", clientX: xy.x, clientY: xy.y });
    await page.mouse.move(xy.x, xy.y);
    if (type === "pointerdown") await page.mouse.down();
    if (type === "pointerup") await page.mouse.up();
  }
  await send("pointerdown", start);
  return {
    hold: async () => { await page.waitForTimeout(510); await send("pointerup", start); },
    lift: async () => { if (phone) await page.waitForTimeout(160); await send("pointermove", { ...start, x: start.x + 16 }); },
    drop: async (el: Locator, at?: number) => {
      const end = await point(el, at); await send("pointermove", end);
      await page.waitForTimeout(40); await send("pointerup", end);
    },
  };
}

async function capture(page: Page, name: string) {
  const dir = process.env.BOT_SCREENSHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, test.info().project.name + "-" + name + ".png") });
}

test("arrastrar filas, cambiar de workspace y soltar en Papelera", async ({ page }) => {
  const { writes, trash } = await world(page);
  const rows = page.locator(".bot-scroll .bot-row");
  const source = rows.filter({ hasText: "Notas" });
  const footer = page.locator(".bot-search-foot");
  const bottom = (await footer.boundingBox())!.y;
  let drag = await gesture(page, source);
  await drag.lift();
  await expect(page.locator(".bot-drop-trash")).toBeVisible();
  await capture(page, "arrastre");
  await drag.drop(rows.filter({ hasText: "Bocetos" }), .2);
  await expect(rows.first()).toContainText("Notas");
  await page.reload();
  await expect(rows.first()).toContainText("Notas");
  drag = await gesture(page, source); await drag.lift();
  const viajes = page.locator("section").filter({ has: page.getByRole("button", { name: "Viajes", exact: true }) });
  await drag.drop(viajes.locator(".bot-group"));
  await expect(viajes.locator("li").last()).toContainText("Notas");
  drag = await gesture(page, source); await drag.lift();
  await drag.drop(page.locator(".bot-drop-trash"));
  await expect(source).toHaveCount(0);
  expect(writes).toEqual(["order", "move", "order", "trash"]);
  expect(trash).toEqual(["fixture-chat-1"]);
  expect((await footer.boundingBox())!.y).toBe(bottom);
});

test("long press, posición, renombrado y confirmación de workspace", async ({ page }) => {
  const { writes } = await world(page);
  const headers = page.locator("section .bot-group");
  const footer = page.locator(".bot-search-foot");
  const bottom = (await footer.boundingBox())!.y;
  const drag = await gesture(page, headers.first()); await drag.lift(); await drag.drop(headers.nth(1));
  await expect(headers.nth(1)).toHaveText("Ideas");
  await page.reload(); await expect(headers.nth(1)).toHaveText("Ideas");
  async function menu() {
    await (await gesture(page, headers.filter({ hasText: "Ideas" }))).hold();
    return page.getByRole("dialog");
  }
  let dialog = await menu(); await expect(dialog).toBeVisible();
  await page.waitForTimeout(290); await capture(page, "workspace");
  expect((await footer.boundingBox())!.y).toBe(bottom);
  await dialog.getByRole("button", { name: "Mover" }).click();
  await dialog.getByLabel("Posición").selectOption({ value: "2" });
  await expect(headers.last()).toHaveText("Ideas");
  await expect(dialog).toHaveCount(0);
  dialog = await menu(); await dialog.getByRole("button", { name: "Renombrar" }).click();
  await dialog.getByRole("textbox").fill("Taller");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(headers.last()).toHaveText("Taller");
  await expect(dialog).toHaveCount(0);
  const last = headers.last();
  await (await gesture(page, last)).hold();
  await page.getByRole("button", { name: "Eliminar workspace" }).click();
  await capture(page, "confirmacion");
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toEqual(["move", "move", "rename"]);
  await (await gesture(page, last)).hold();
  await page.getByRole("button", { name: "Eliminar workspace" }).click();
  await page.getByRole("button", { name: "Enviar a Papelera" }).click();
  await expect(headers).toHaveCount(2);
  expect(writes.at(-1)).toBe("trashWorkspace");
  expect((await footer.boundingBox())!.y).toBe(bottom);
});

test("la entrada táctil de Chromium permite desplazar la lista y arrastrar tras una pausa", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "El protocolo CDP de entrada táctil solo existe en Chromium.");
  await page.setViewportSize({ width: 390, height: 510 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const { writes } = await world(page);
  const rows = page.locator(".bot-scroll .bot-row");
  const p = await point(rows.nth(1));
  const send = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await send("touchStart", p.x, p.y);
  await send("touchMove", p.x, p.y - 35);
  await send("touchMove", p.x, p.y - 95);
  await send("touchEnd", p.x, p.y - 95);
  await expect.poll(() => page.locator(".bot-scroll").evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(writes).toEqual([]);
  await rows.first().scrollIntoViewIfNeeded();
  const start = await point(rows.nth(1));
  const end = await point(rows.first(), .2);
  await send("touchStart", start.x, start.y);
  await page.waitForTimeout(180);
  await send("touchMove", start.x, start.y - 20);
  await expect(page.locator(".bot-drop-trash")).toBeVisible();
  await send("touchMove", end.x, end.y);
  await send("touchEnd", end.x, end.y);
  await expect(rows.first()).toContainText("Notas");
  expect(writes).toEqual(["order"]);
});
