import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fixtureAgents, fixtureKiroChat, fixtureLaunchedTab, fixtureSnapshot } from "@/test/handlers";
import type { AgentView } from "@/lib/types";
import { installApiStub, installLauncherWorld, installPaneWorld, paneCapture } from "./fixtures/api";

test.use({ serviceWorkers: "block" });

test("workspace list, chat input and bot creation", async ({ page }, info) => {
  const phone = info.project.name.includes("phone");
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await installApiStub(page);
  const launch = await installLauncherWorld(page);
  const now = Date.now();
  const names = ["Kanban · Orquestador", "Kanban · Menú y Updates", "Kanban · Puente OpenBot", "Kanban · Multicuenta", "Duck Race · Rooms", "Orquestador Duck", "Duck Race · Backend", "Duck Race · Diseño", "Duck Race · Plan", "Viajes"];
  const previews = ["¿Subo el nuevo menú de Kanban a producción?", "¿Cómo lo pasamos a producción?", "Ya le avisé a Kanban · Orquestador del cierre.", "Mensaje de Aviso de agentes", "El diseño de las salas ya está listo.", "Le escribió a Duck Race · Rooms", "La revisión terminó.", "Ya está lista la propuesta.", "Revisamos las reglas de juego.", "Reunión del domingo"];
  const sections = ["Kanban agents", "Duck duck race", "Viajes"];
  const panes: AgentView[] = names.map((name, i) => {
    const group = i < 4 ? 0 : i < 9 ? 1 : 2;
    const space = "w" + (group + 1);
    return Object.assign({}, fixtureAgents[0]!, { paneId: space + ":p" + (i + 1), workspaceId: space, workspaceLabel: sections[group]!, paneLabel: name, agent: "kiro", hasSession: true, hint: previews[i], status: "idle" as const, focused: i === 0, lastActiveAt: now - (i + 1) * 60000, lastSeenAt: [0, 4, 5].includes(i) ? now - 3600000 : now });
  });
  const snapshot = { ...fixtureSnapshot, agents: panes, shellPanes: [], workspaces: sections.map((label, i) => ({ ...fixtureSnapshot.workspaces[0]!, workspaceId: "w" + (i + 1), label })), ts: now };
  const messages = ["¿Ya está listo el cambio del menú?", "Ya está listo el cambio del menú: los enlaces de Discord y GitHub están visibles y el botón de actualizar se oculta. Lo puedes ver en la instancia de prueba.", "¿Qué falta para subirlo?", "Primero haré un respaldo del volumen de datos de Kanban. Después cambiaré la imagen y reiniciaré el servicio."];
  const upserts = messages.map((text, i) => ({ uuid: "test-" + i, ts: new Date(now - (4-i) * 2000000).toISOString(), role: i % 2 === 0 ? "user" as const : "assistant" as const, parts: [{ kind: "text" as const, text }], seq: i + 1 }));
  if (fixtureKiroChat.page !== "live") throw new Error("Expected a live chat fixture");
  await installPaneWorld(page, { paneId: panes[0]!.paneId, snapshot, chat: { ...fixtureKiroChat, oldest: 1, head: 4, upserts }, start: "idle", screens: { idle: paneCapture("kiro--v3-idle-w120") } });
  const screenshot = async (label: string) => {
    const dir = process.env.BOT_SCREENSHOTS;
    if (dir) {
      await mkdir(dir, { recursive: true });
      await page.screenshot({ path: join(dir, (info.project.name.includes("webkit") ? "iphone-webkit-" : phone ? "movil-" : "escritorio-") + label + ".png"), animations: "disabled" });
    }
  };
  await page.goto("/");
  const rows = page.locator(".bot-row");
  await expect(rows).toHaveCount(10);
  await screenshot("lista");
  await page.getByRole("button", { name: sections[0], exact: true }).click();
  await expect(rows).toHaveCount(6);
  const search = page.getByRole("searchbox", { name: "Buscar" });
  await search.fill("Puente");
  await expect(rows).toHaveCount(1);
  await search.fill("");
  await page.getByRole("button", { name: sections[0], exact: true }).click();
  await rows.first().click();
  await expect(page.getByText(messages[3]!, { exact: true })).toBeVisible();
  await expect(page.getByText("Nuevos", { exact: true })).toBeVisible();
  await screenshot("conversacion");
  const input = page.locator('[data-slot="composer-box"] textarea').first();
  await input.fill("Recibido");
  const posted = page.waitForRequest(r => r.method() === "POST" && /\/(reply|send)$/.test(r.url()));
  await page.locator('[data-slot="composer-primary"]').click();
  expect((await posted).postDataJSON().text).toBe("Recibido");
  await page.getByRole("button", { name: "Opciones del chat" }).click();
  await page.getByRole("button", { name: "Ver terminal" }).click();
  await expect(page.locator(".bot-terminal")).toBeVisible();
  await page.getByRole("button", { name: "Volver a los chats" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Crear nuevo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Crear nuevo Bot" });
  await expect(dialog.getByRole("button", { name: "Crear", exact: true })).toBeDisabled();
  await screenshot("crear");
  await dialog.getByRole("button", { name: "Forma 4", exact: true }).click();
  await dialog.getByRole("button", { name: "Verde", exact: true }).click();
  await dialog.getByRole("textbox").fill("Bitácora");
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await expect.poll(() => launch.launches.length).toBe(1);
  await expect(page.locator(".bot-chat-bar strong")).toHaveText("Bitácora");
  expect(launch.launches[0]?.body.paneId).toBe(panes[0]!.paneId);
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(fixtureLaunchedTab.pane.paneId)));
});
