import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fixtureAgents, fixtureKiroChat, fixtureLaunchedTab, fixtureSnapshot, fixtureWalkyAgent } from "@/test/handlers";
import type { AgentView } from "@/lib/types";
import { installApiStub, installLauncherWorld, installPaneWorld, paneCapture, pinLocale } from "./fixtures/api";

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page }, info) => {
  const phone = info.project.name.includes("phone");
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1280, height: 800 });
  await pinLocale(page, "es");
});

async function screenshot(page: Page, label: string) {
  const dir = process.env.BOT_SCREENSHOTS;
  if (!dir) return;
  const project = test.info().project.name;
  const prefix = project.includes("webkit") ? "iphone-webkit" : project.includes("phone") ? "movil" : "escritorio";
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, prefix + "-" + label + ".png"), animations: "disabled" });
}

test("workspace list, chat input and bot creation", async ({ page }) => {
  await installApiStub(page);
  const launch = await installLauncherWorld(page);
  const now = Date.now();
  const names = ["Kanban · Orquestador", "Kanban · Menú y Updates", "Kanban · Puente OpenBot", "Kanban · Multicuenta", "Duck Race · Rooms", "Orquestador Duck", "Duck Race · Backend", "Duck Race · Diseño", "Duck Race · Plan", "Viajes", "Itinerario", "Reservas", "Rutas", "Hoteles", "Equipaje", "Calendario", "Guías", "Archivo"];
  const previews = ["¿Subo el nuevo menú de Kanban a producción?", "¿Cómo lo pasamos a producción?", "Ya le avisé a Kanban · Orquestador del cierre.", "Mensaje de Aviso de agentes", "El diseño de las salas ya está listo.", "Le escribió a Duck Race · Rooms", "La revisión terminó.", "Ya está lista la propuesta.", "Revisamos las reglas de juego.", "Reunión del domingo"];
  const sections = ["Kanban agents", "Duck duck race", "Viajes"];
  const panes: AgentView[] = names.map((name, i) => {
    const group = i < 4 ? 0 : i < 9 ? 1 : 2;
    const space = "w" + (group + 1);
    return Object.assign({}, fixtureAgents[0]!, { paneId: space + ":p" + (i + 1), workspaceId: space, workspaceLabel: sections[group]!, paneLabel: name, agent: "kiro", hasSession: true, hint: previews[i] ?? "Última actualización del viaje.", status: "idle" as const, focused: i === 0, lastActiveAt: now - (i + 1) * 60000, lastSeenAt: [0, 4, 5, 12, 16, 17].includes(i) ? now - 3600000 : now });
  });
  const snapshot = { ...fixtureSnapshot, agents: panes, shellPanes: [], workspaces: sections.map((label, i) => ({ ...fixtureSnapshot.workspaces[0]!, workspaceId: "w" + (i + 1), label })), ts: now };
  const peer = Object.assign({}, fixtureWalkyAgent, {
    at: now, from: { ...fixtureWalkyAgent.from, label: "Avisos de agentes" }, body: "¿Qué falta para subirlo?",
  });
  await page.route(url => url.pathname.endsWith("/walky"), route => route.fulfill({ json: { messages: [peer] } }));
  const messages = ["¿Ya está listo el cambio del menú?", "Ya está listo el cambio del menú: los enlaces de Discord y GitHub están visibles y el botón de actualizar se oculta. Lo puedes ver en la instancia de prueba.", `[walky-talky ${peer.id}] from agent Avisos de agentes`, "Primero haré un respaldo del volumen de datos de Kanban. Después cambiaré la imagen y reiniciaré el servicio."];
  const upserts = messages.map((text, i) => ({ uuid: "test-" + i, ts: new Date(now - (4-i) * 2000000).toISOString(), role: i % 2 === 0 ? "user" as const : "assistant" as const, parts: [{ kind: "text" as const, text }], seq: i + 1 }));
  if (fixtureKiroChat.page !== "live") throw new Error("Expected a live chat fixture");
  const world = await installPaneWorld(page, { paneId: panes[0]!.paneId, snapshot, chat: { ...fixtureKiroChat, oldest: 1, head: 4, upserts }, start: "approval", screens: { idle: paneCapture("kiro--v3-idle-w120"), approval: paneCapture("kiro--v3-approval-allow-w120") },
    script: [{ on: "approval", keys: ["Enter"], to: "idle" }] });
  await page.goto("/");
  const rows = page.locator(".bot-row");
  await expect(rows).toHaveCount(names.length);
  await expect(page.locator(".bot-user")).toHaveText("J");
  await expect(page.locator(".bot-unread")).toHaveCount(6);
  await expect(page.locator(".bot-row .bot-line svg")).toHaveCount(names.length);
  const down = page.locator(".bot-jump-down");
  await expect(down).toBeVisible();
  await screenshot(page, "lista");
  await down.click();
  await expect(page.locator(".bot-jump-up")).toBeVisible();
  expect(await page.locator(".bot-featured").evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThan(0);
  await expect(page.locator(".bot-user")).toBeInViewport();
  await expect(page.locator(".bot-bar").first().locator(".bot-pill")).toHaveCount(0);
  await screenshot(page, "lista-scroll");
  await page.locator(".bot-scroll").evaluate(el => el.scrollTo(0, 0));
  await page.getByRole("button", { name: sections[0], exact: true }).click();
  await expect(rows).toHaveCount(names.length - 4);
  const search = page.getByRole("searchbox", { name: "Buscar" });
  await search.fill("Puente");
  await expect(rows).toHaveCount(1);
  await search.fill("");
  await page.getByRole("button", { name: sections[0], exact: true }).click();
  await rows.first().click();
  await expect(page.getByText(messages[3]!, { exact: true })).toBeVisible();
  await expect(page.getByText("Nuevos", { exact: true })).toBeVisible();
  await expect(page.getByText("4 mensajes con 2 Bots")).toBeAttached();
  await expect(page.getByText("Mensaje de Avisos de agentes", { exact: true })).toBeAttached();
  await expect(page.locator(".bot-attribution").filter({ hasText: "Mensaje de" }).last()).toBeVisible();
  await expect(page.locator(".bot-attribution").filter({ hasText: "Escribió a" }).first()).toBeAttached();
  const choices = page.locator('[data-slot="prompt-options"]');
  await expect(choices.getByRole("button", { name: "Allow", exact: true })).toBeVisible();
  await screenshot(page, "acciones");
  await choices.getByRole("button", { name: "Allow", exact: true }).click();
  await expect.poll(() => world.sent.map(write => write.keys)).toEqual([["Enter"]]);
  await expect(choices).toHaveCount(0);
  await expect(page.locator('[data-slot="composer-mic-draft"]')).toBeVisible();
  await expect(page.locator('[data-slot="composer-primary"] svg.lucide-audio-lines')).toBeVisible();
  if (test.info().project.name.includes("phone")) {
    const covered = await page.locator(".bot-jump").evaluateAll(chips => chips.every(chip => {
      const box = chip.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest(".bot-detail");
    }));
    expect(covered).toBe(true);
  }
  await screenshot(page, "conversacion");
  const input = page.locator('[data-slot="composer-box"] textarea').first();
  await input.fill("Recibido");
  const posted = page.waitForRequest(r => r.method() === "POST" && /\/(reply|send)$/.test(r.url()));
  if (test.info().project.name.includes("phone")) await page.locator('[data-slot="composer-primary"]').click();
  else await input.press("Enter");
  expect((await posted).postDataJSON().text).toBe("Recibido");
  await page.getByRole("button", { name: "Opciones del chat" }).click();
  await page.getByRole("button", { name: "Ver terminal" }).click();
  await expect(page.locator(".bot-terminal")).toBeVisible();
  await page.getByRole("button", { name: "Volver a los chats" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Crear nuevo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Crear nuevo Bot" });
  await expect(dialog.getByRole("button", { name: "Crear", exact: true })).toBeDisabled();
  await screenshot(page, "crear");
  await dialog.getByRole("button", { name: "Forma 4", exact: true }).click();
  await dialog.getByRole("button", { name: "Verde", exact: true }).click();
  await dialog.getByRole("textbox").fill("Bitácora");
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await expect.poll(() => launch.launches.length).toBe(1);
  await expect(page.locator(".bot-chat-bar strong")).toHaveText("Bitácora");
  expect(launch.launches[0]?.body.paneId).toBe(panes[0]!.paneId);
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(fixtureLaunchedTab.pane.paneId)));
});

for (const pairedGate of [false, true]) {
  test(pairedGate ? "unpaired device keeps navigation" : "sign-in keeps navigation", async ({ page }) => {
    await installApiStub(page);
    await page.route(url => url.pathname === "/api/snapshot", route => route.fulfill({
      status: 403, contentType: "text/plain", body: pairedGate ? "device not paired" : "Access refused",
    }));
    await page.goto("/");
    const notice = page.locator(".bot-index .bot-access");
    await expect(notice.getByRole("link")).toHaveAttribute("href", pairedGate ? /settings/ : /auth\/$/);
    const search = page.getByRole("searchbox");
    await search.fill("Kanban");
    await search.fill("");
    await expect(page.locator(".bot-user")).toHaveText("J");
    expect(await page.locator(".bot-bar").evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(
      await notice.evaluate(el => el.getBoundingClientRect().top));
    await screenshot(page, pairedGate ? "sin-emparejar" : "sign-in");
    await page.getByRole("button", { name: "Crear nuevo", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("textbox").fill("Bitácora");
    await expect(sheet.getByRole("button", { name: "Crear", exact: true })).toBeDisabled();
    await expect(sheet.getByRole("link")).toBeVisible();
  });
}
