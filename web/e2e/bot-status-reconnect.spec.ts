import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentView } from "@/lib/types";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot, sendAnswer } from "@/test/handlers";
import { installApiStub, installPaneWorld, paneCapture, pinLocale } from "./fixtures/api";

async function open(page: Page, outcome?: NonNullable<AgentView["lastSend"]>["outcome"]) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const agent: AgentView = { ...fixtureAgents[0]!, agent: "codex", kind: "agent", status: "done",
    surface: { revision: 1, turn: "idle", modal: "none", composer: "empty" },
    paneLabel: "Codex de prueba", hasSession: true,
    ...(outcome && { lastSend: { requestId: "last-send-0001", at: Date.now(), outcome } }),
  };
  await installPaneWorld(page, { paneId: agent.paneId,
    snapshot: { ...fixtureSnapshot, agents: [agent], shellPanes: [], ts: Date.now(),
      device: { enforced: true, authorized: true, device: "Prueba" } },
    chat: { ...fixtureKiroChat, paneId: agent.paneId },
    screens: { idle: paneCapture("codex--v0172-agent-hint-idle") }, start: "idle" });
  const keys: unknown[] = [];
  await page.route(url => /\/api\/pane\/[^/]+\/keys$/u.test(url.pathname), async route => {
    keys.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true } });
  });
  return { agent, keys };
}
async function shot(page: Page, name: string) {
  const directory = process.env.BOT_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${test.info().project.name}-${name}.png`), animations: "disabled" });
}

for (const [outcome, label] of [["refused", "El último mensaje no llegó"], ["unknown", "Envío sin confirmar"], ["pending", "Enviando…"]] as const) {
  test(`${outcome}: list and chat expose delivery instead of Ready`, async ({ page }) => {
    const { agent } = await open(page, outcome);
    await page.goto("/");
    await expect(page.getByRole("listitem").filter({ hasText: "Codex de prueba" })).toContainText(label);
    await shot(page, `${outcome}-list`);
    await page.goto("/pane/" + encodeURIComponent(agent.paneId));
    const status = page.getByRole("status").filter({ hasText: label });
    await expect(status).toBeVisible();
    expect(await status.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await shot(page, `${outcome}-chat`);
  });
}

test("reload during a lost response preserves the request id for one retry and leaks no keys", async ({ page }) => {
  const { agent, keys } = await open(page);
  const sends: { id: string; text: string }[] = [];
  await page.route(url => url.pathname === "/api/send", async route => {
    // SAFETY: this handler receives the composer's SendRequestBody.
    const body = route.request().postDataJSON() as { id: string; text: string };
    sends.push(body);
    if (sends.length === 1) { await route.abort("failed"); return; }
    await route.fulfill({ json: sendAnswer(body.id, "sent") });
  });
  await page.goto("/pane/" + encodeURIComponent(agent.paneId));
  const field = page.getByRole("textbox");
  await field.fill("Conserva este envío al reconectar");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect.poll(() => sends.length).toBe(1);
  await expect(field).toHaveValue("Conserva este envío al reconectar");
  await expect(page.getByRole("status").filter({ hasText: "Envío sin confirmar" })).toBeVisible();
  await shot(page, "lost-response");
  await page.reload();
  await expect(field).toHaveValue("Conserva este envío al reconectar");
  await expect(page.getByRole("status").filter({ hasText: "Envío sin confirmar" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("listitem").filter({ hasText: "Codex de prueba" })).toContainText("Envío sin confirmar");
  await shot(page, "lost-response-list");
  await page.goto("/pane/" + encodeURIComponent(agent.paneId));
  await expect(field).toHaveValue("Conserva este envío al reconectar");
  for (const key of ["Control+m", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape"]) await field.press(key);
  expect(keys).toEqual([]);
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect.poll(() => sends.length).toBe(2);
  expect(sends[1]).toEqual(sends[0]);
  await expect(field).toHaveValue("");
  expect(keys).toEqual([]);
  await shot(page, "reconnected-retry");
});
