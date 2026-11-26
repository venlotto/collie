import { expect as baseExpect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { TranscriptEntry } from "@/lib/types";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot } from "@/test/handlers";
import { installApiStub, installPaneWorld, pinLocale } from "./fixtures/api";

const expect = baseExpect.configure({ timeout: 15_000 });

function journal(harness: "codex" | "claude" | "codex-attention"): TranscriptEntry[] {
  const reader = fileURLToPath(new URL("./fixtures/bot-journal.mjs", import.meta.url));
  return JSON.parse(execFileSync("bun", [reader, harness], { encoding: "utf8" }));
}

async function openThread(page: Page, harness: string, entries: TranscriptEntry[], status: "idle" | "working" | "blocked" = "idle") {
  await pinLocale(page, "es");
  await installApiStub(page);
  const agent = { ...fixtureAgents[0]!, agent: harness, hasSession: true, status,
    ...(status === "blocked" && { blockedBy: "error" as const }),
    paneLabel: "Informes", workspaceLabel: "Noviembre" };
  if (fixtureKiroChat.page !== "live") throw new Error("Expected a live window");
  await installPaneWorld(page, { paneId: agent.paneId, snapshot: { ...fixtureSnapshot, agents: [agent], shellPanes: [],
    workspaces: [{ ...fixtureSnapshot.workspaces[0]!, label: agent.workspaceLabel }] },
    chat: { ...fixtureKiroChat, head: entries.length, oldest: 1, upserts: entries.map((entry, i) => ({ ...entry, seq: i + 1 })) },
    screens: { idle: "› Ask Codex to do anything\nfixture-model · 1 warning" }, start: "idle" });
  await page.goto("/");
  await page.locator(".bot-row").first().click();
}

async function shot(page: Page, name: string) {
  const dir = process.env.BOT_SCREENSHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  const device = test.info().project.name === "phone-webkit" ? "iphone-webkit" : "desktop";
  await page.screenshot({ path: join(dir, device + "-" + name + ".png"), scale: "css", animations: "disabled" });
}

for (const harness of ["claude", "codex"] as const) {
  test(harness + " journal keeps a turn's work in one disclosure", async ({ page }) => {
    await openThread(page, harness, journal(harness));
    await expect(page.locator(".bot-turn-reply strong")).toHaveText("El informe está listo.");
    const steps = page.getByRole("button", { name: harness === "codex" ? "8 pasos" : "9 pasos", exact: true });
    await expect(steps).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".bot-turn-user")).toHaveCount(1);
    await expect(page.locator(".bot-activity")).toHaveCount(1);
    await expect(page.locator(".bot-turn-reply")).toHaveCount(1);
    await expect(page.getByText(/Ask Codex to do anything|fixture developer context|fixture duplicate event|wc -l noviembre/)).toHaveCount(0);
    if (harness === "claude") await shot(page, "after");
    await steps.click();
    await expect(steps).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".bot-activity-detail")).toContainText("wc -l noviembre.csv");
    await expect(page.getByText("Revisar las fechas", { exact: true })).toBeVisible();
    if (harness === "claude") await shot(page, "pasos");
    await steps.click();
    await expect(page.locator(".bot-activity-detail")).toHaveCount(0);
  });
}

test("a command failure and a question stay visible across intervening steps", async ({ page }) => {
  await openThread(page, "codex", [...journal("codex"), ...journal("codex-attention")]);
  await expect(page.locator(".bot-turn-error")).toContainText("octubre.csv");
  await expect(page.locator(".bot-turn-question")).toContainText("¿Qué archivo de octubre uso?");
  await expect(page.getByRole("button", { name: "2 pasos", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".bot-activity")).toHaveCount(2);
  await shot(page, "error-pregunta");
});

test("only the latest turn is working and the screen is reached through the menu", async ({ page }) => {
  const latest = journal("codex-attention").slice(0, 2);
  await openThread(page, "codex", [...journal("codex"), ...latest], "working");
  await expect(page.getByRole("button", { name: "8 pasos", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sigue trabajando…" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-slot="stream-live"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Opciones del chat" }).click();
  await page.getByRole("radio", { name: "Terminal", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".bot-terminal-label")).toHaveText("Terminal");
  await expect(page.locator(".bot-activity")).toHaveCount(0);
});

test("an agent that stopped on an error explains the interruption", async ({ page }) => {
  await openThread(page, "claude", journal("claude").slice(0, -1), "blocked");
  await expect(page.getByRole("status").filter({ hasText: "El agente se detuvo por un error." })).toBeVisible();
  await expect(page.getByRole("button", { name: "9 pasos", exact: true })).toHaveAttribute("aria-expanded", "false");
});
