import { expect as baseExpect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { TranscriptEntry } from "@/lib/types";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot } from "@/test/handlers";
import { installApiStub, installPaneWorld, pinLocale } from "./fixtures/api";

const expect = baseExpect.configure({ timeout: 15_000 });
test.use({ serviceWorkers: "block" });

function journal(): TranscriptEntry[] {
  const reader = fileURLToPath(new URL("./fixtures/bot-journal.mjs", import.meta.url));
  return JSON.parse(execFileSync("bun", [reader, "claude"], { encoding: "utf8" }));
}

async function shot(page: Page, name: string) {
  const dir = process.env.BOT_SCREENSHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  const device = test.info().project.name === "phone-webkit" ? "iphone-webkit" : "desktop";
  await page.screenshot({ path: join(dir, device + "-" + name + ".png"), scale: "css", animations: "disabled" });
}

async function setup(page: Page, agentName: string, hasSession: boolean) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const agent = { ...fixtureAgents[0]!, agent: agentName, hasSession, status: "idle" as const,
    paneLabel: agentName === "kimi" ? "Kimi" : "Sin lector", terminalId: "display-" + agentName };
  const snapshot = { ...fixtureSnapshot, agents: [agent], shellPanes: [], ts: Date.now(),
    device: { authorized: true, enforced: true, device: "Campo" } };
  const entries = journal();
  if (fixtureKiroChat.page !== "live") throw new Error("Expected a live chat fixture");
  await installPaneWorld(page, { paneId: agent.paneId, snapshot,
    chat: { ...fixtureKiroChat, head: entries.length, oldest: 1, upserts: entries.map((entry, i) => Object.assign({}, entry, { seq: i + 1 })) },
    screens: { idle: "› Ask the fixture bot anything" }, start: "idle" });
  await page.goto("/");
  await page.locator(".bot-row").first().click();
  await expect(page.getByRole("button", { name: "Opciones del chat" })).toBeVisible();
  return agent;
}

async function choose(page: Page, view: "Mensajes" | "Terminal") {
  await page.getByRole("button", { name: "Opciones del chat" }).click();
  const group = page.getByRole("radiogroup", { name: "Vista", exact: true });
  await expect(group).toBeVisible();
  await group.getByRole("radio", { name: view, exact: true }).click();
  await expect(group.getByRole("radio", { name: view, exact: true })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
}

async function send(page: Page, text: string) {
  const input = page.locator('[data-slot="composer-box"] textarea').first();
  await input.fill(text);
  await expect(input).toHaveValue(text);
  const posted = page.waitForRequest(request => request.method() === "POST" && /\/(reply|send)$/.test(request.url()));
  if (test.info().project.name.includes("phone")) await page.locator('[data-slot="composer-primary"]').click();
  else await input.press("Enter");
  expect((await posted).postDataJSON().text).toBe(text);
}

test("Kimi abre Mensajes, alterna sin recrear el bot y conserva la elección del servidor", async ({ page }) => {
  await setup(page, "kimi", true);
  await expect(page.locator(".bot-turn-reply strong")).toHaveText("El informe está listo.");
  await expect(page.locator(".bot-terminal")).toHaveCount(0);
  await send(page, "Mensaje desde chat");
  await shot(page, "mensajes-kimi");

  await choose(page, "Terminal");
  await expect(page.locator(".bot-terminal")).toBeVisible();
  await expect(page.locator(".bot-turn-reply")).toHaveCount(0);
  await send(page, "Mensaje desde terminal");
  await shot(page, "terminal-kimi");

  await page.reload();
  await expect(page.locator(".bot-terminal")).toBeVisible();
  await expect(page.locator(".bot-turn-reply")).toHaveCount(0);

  await page.getByRole("button", { name: "Opciones del chat" }).click();
  const display = page.getByRole("radiogroup", { name: "Vista", exact: true });
  await expect(display.getByRole("radio", { name: "Terminal", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Mensajes muestra la conversación como chat. Terminal muestra la pantalla tal cual.")).toBeVisible();
  for (const radio of await display.getByRole("radio").all()) {
    expect((await radio.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await shot(page, "ajustes-vista");
  await display.getByRole("radio", { name: "Mensajes", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".bot-turn-reply strong")).toHaveText("El informe está listo.");
  await page.reload();
  await expect(page.locator(".bot-turn-reply strong")).toHaveText("El informe está listo.");
});

test("sin transcripción Mensajes explica el estado y Ver terminal es reversible", async ({ page }) => {
  await setup(page, "sin-adaptador", false);
  await expect(page.locator('[data-slot="chat-unavailable"]')).toBeVisible();
  await expect(page.locator(".bot-terminal")).toHaveCount(0);
  await expect(page.locator('[data-slot="composer-box"] textarea').first()).toBeVisible();
  await shot(page, "mensajes-sin-transcripcion");

  await page.getByRole("button", { name: "Ver terminal", exact: true }).click();
  await expect(page.locator(".bot-terminal")).toBeVisible();
  await expect(page.locator('[data-slot="chat-unavailable"]')).toHaveCount(0);
  await shot(page, "terminal-desde-estado-vacio");

  await choose(page, "Mensajes");
  await expect(page.locator('[data-slot="chat-unavailable"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-slot="chat-unavailable"]')).toBeVisible();
});
