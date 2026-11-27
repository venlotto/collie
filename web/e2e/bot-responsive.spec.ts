import { expect, test, type Page, type Locator } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot } from "@/test/handlers";
import { installApiStub, installLauncherWorld, installPaneWorld, paneCapture, pinLocale } from "./fixtures/api";

const TITLE = "Auditoría de conversaciones y paneles con nombres extensos";

test.beforeEach(async ({ page }) => {
  // A context-level backstop also catches late WebKit polls after page routes are removed.
  // This makes the same suite safe against deployed assets: every API call stays in fixtures.
  await page.context().route("**/api/**", route => route.fulfill({ status: 503, body: "Unstubbed audit request" }));
  await pinLocale(page, "es");
  await installApiStub(page);
  // The same upload capability exercised by composer-media.test.tsx.
  await page.route("**/api/config", route => route.fulfill({ json: { push: false, vapidPublicKey: "", upload: {
    maxBytes: 1024, imageTypes: ["png"], textTypes: ["txt"], videoTypes: ["mp4", "mov", "webm"],
  } } }));
  await installLauncherWorld(page);
  const agent = { ...fixtureAgents[0]!, agent: "kiro", hasSession: true, status: "idle" as const,
    paneLabel: TITLE, workspaceLabel: "Workspace_con_un_nombre_muy_largo_sin_espacios_para_comprobar_el_ancho" };
  await installPaneWorld(page, { paneId: agent.paneId,
    snapshot: { ...fixtureSnapshot, agents: [agent], shellPanes: [], ts: Date.now(),
      workspaces: [{ ...fixtureSnapshot.workspaces[0]!, label: agent.workspaceLabel }],
      device: { enforced: true, authorized: true, device: "Auditoría" } },
    chat: { ...fixtureKiroChat, paneId: agent.paneId },
    screens: { idle: paneCapture("kiro--v3-idle-w120") }, start: "idle" });
  await page.goto("/");
});

async function capture(page: Page, label: string) {
  const dir = process.env.BOT_SCREENSHOTS;
  const geometry = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>(".bot-layout,.bot-sidebar,.bot-detail,.bot-window .bot-bar,.bot-desk-ctrls,.bot-window .bot-pill,.bot-popup:popover-open,.bot-sheet,[data-slot=composer-box]")]
      .filter(el => el.checkVisibility()).map(el => {
        const r = el.getBoundingClientRect();
        return { name: el.className, x: r.x, y: r.y, width: r.width, height: r.height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      });
    return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, boxes };
  });
  if (dir) {
    await mkdir(dir, { recursive: true });
    const name = test.info().project.name + "-" + label;
    await page.screenshot({ path: join(dir, name + ".png"), animations: "disabled", scale: "css" });
    await writeFile(join(dir, name + ".json"), JSON.stringify(geometry, null, 2));
  }
  expect.soft(geometry.documentWidth).toBeLessThanOrEqual(geometry.width);
}

async function fits(locator: Locator) {
  await expect(locator).toBeVisible();
  const viewport = locator.page().viewportSize()!;
  // WebKit can report transform:none before scheduling a sheet's first animation frame.
  // Wait for the actual resting bounds, rather than sampling the entrance halfway through.
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    return box && {
      left: box.x >= -1,
      top: box.y >= -1,
      right: box.x + box.width <= viewport.width + 1,
      bottom: box.y + box.height <= viewport.height + 1,
    };
  }).toEqual({ left: true, top: true, right: true, bottom: true });
}

test("list, chat, composer and menus fit the viewport", async ({ page }) => {
  await fits(page.getByRole("searchbox"));
  await capture(page, "lista");
  const group = page.getByRole("button", { name: /^Workspace_con/ });
  expect.soft(await group.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("button").filter({ hasText: TITLE }).first().click();
  const field = page.getByRole("textbox");
  await expect(field).toBeVisible();
  await capture(page, "chat");
  await fits(field);
  await field.fill("Borrador de auditoría\nSegunda línea con texto largo para comprobar el ajuste a la pantalla\nTercera línea");
  await fits(page.getByRole("button", { name: "Enviar", exact: true }));
  await capture(page, "composer");
  const latest = page.getByRole("button", { name: "Desplazarse a lo más reciente", exact: true });
  await expect(latest).toBeVisible();
  const jumpBox = (await latest.boundingBox())!;
  const composerBox = (await field.locator("..").boundingBox())!;
  expect.soft(jumpBox.y + jumpBox.height).toBeLessThanOrEqual(composerBox.y);
  await page.getByRole("button", { name: "Opciones del chat" }).click();
  await fits(page.getByRole("radiogroup", { name: "Vista", exact: true }));
  await capture(page, "menu");
  await page.getByRole("radio", { name: "Terminal", exact: true }).click();
  await page.keyboard.press("Escape");
  await capture(page, "terminal");
});

test("create sheets keep every control reachable", async ({ page }) => {
  await page.getByRole("button", { name: "Crear nuevo", exact: true }).click({ button: "right" });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("form")).toHaveCSS("transform", "none");
  await capture(page, "crear");
  await fits(dialog.getByRole("textbox").first());
  const create = dialog.getByRole("button", { name: "Crear", exact: true });
  await create.scrollIntoViewIfNeeded();
  await fits(create);
  await capture(page, "crear-final");
  await dialog.getByRole("button", { name: "Existente", exact: true }).click();
  await fits(dialog.getByRole("combobox", { name: "Workspace existente" }));
  await capture(page, "crear-workspace");
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 440 });
  await create.scrollIntoViewIfNeeded();
  await fits(create);
  await capture(page, "crear-bajo");
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).scrollIntoViewIfNeeded();
  await fits(dialog.getByRole("button", { name: "Cerrar", exact: true }));
});


test("the hub respects the corrected app height", async ({ page }) => {
  await page.evaluate(() => document.documentElement.style.setProperty("--app-h", "420px"));
  await expect.poll(async () => (await page.getByRole("searchbox").boundingBox())!.y).toBeLessThan(420);
});

test("long titles leave window controls usable on the desk", async ({ page }) => {
  test.skip(page.viewportSize()!.width < 1280, "two desktop windows need room");
  const agents = fixtureAgents.slice(0, 2).map((a, i) => Object.assign({}, a, { hasSession: true, status: "idle" as const,
    paneLabel: `${TITLE} ${i}`, terminalId: `audit-${i}` }));
  for (const agent of agents) await installPaneWorld(page, { paneId: agent.paneId,
    snapshot: { ...fixtureSnapshot, agents, shellPanes: [], ts: Date.now() }, chat: fixtureKiroChat,
    screens: { idle: paneCapture("kiro--v3-idle-w120") }, start: "idle" });
  await page.reload();
  for (const agent of agents) {
    await page.getByRole("button").filter({ hasText: agent.paneLabel }).first().click();
    await expect(page.getByRole("main").getByText(agent.paneLabel, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Minimizar", exact: true })).toHaveCount(2);
  for (const region of await page.getByRole("region", { name: /Auditoría/ }).all()) {
    await expect.poll(() => region.evaluate(el => el.getAnimations().length)).toBe(0);
  }
  await capture(page, "paneles");
  for (const region of await page.getByRole("region", { name: /Auditoría/ }).all()) {
    const close = (await region.getByRole("button", { name: "Cerrar ventana" }).boundingBox())!;
    const title = (await region.getByText(/Auditoría/, { exact: false }).first().locator("..").boundingBox())!;
    expect.soft(close.x + close.width).toBeLessThanOrEqual(title.x);
    const menu = region.getByRole("button", { name: "Opciones del chat" });
    if (await menu.count()) await fits(menu);
  }
});


test("attachments, editing and a short viewport stay usable", async ({ page }) => {
  await page.getByRole("button").filter({ hasText: TITLE }).first().click();
  await page.getByRole("button", { name: "Adjuntar archivo", exact: true }).click();
  const attachments = page.getByRole("dialog", { name: "Adjuntar", exact: true });
  await fits(attachments);
  await expect(attachments.getByRole("button", { name: "Videos", exact: true })).toBeVisible();
  await capture(page, "adjuntos");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Opciones del chat" }).click();
  await page.getByRole("button", { name: "Editar bot", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Editar bot", exact: true });
  await expect(dialog.locator("form")).toHaveCSS("transform", "none");
  await fits(dialog.getByRole("textbox", { name: "Nombre del bot" }));
  await capture(page, "editar");
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const field = page.getByRole("textbox");
  await field.fill("Borrador que se conserva al cambiar de tamaño");
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 440 });
  await fits(field);
  await fits(page.getByRole("button", { name: "Enviar", exact: true }));
  await expect(field).toHaveValue("Borrador que se conserva al cambiar de tamaño");
  await capture(page, "chat-bajo");
});
