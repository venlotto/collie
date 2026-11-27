// A Codex bot after a send that stayed in the box (typed_not_submitted, the live report of 2026-11-27):
// the "Borrador en la terminal" notice floats in the pane's slot. It must sit ABOVE the composer and never
// over it: the live phone showed it over the textarea, and every tap on the field went to the notice.
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Surface } from "@/lib/surface/surface";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot, sendAnswer } from "@/test/handlers";
import { installApiStub, installPaneWorld, paneCapture, pinLocale } from "./fixtures/api";

const expect = baseExpect.configure({ timeout: 15_000 });
test.use({ serviceWorkers: "block" });

const DRAFT: Surface = { revision: 4, turn: "idle", modal: "none", composer: "draft" };
const LONG = "Explica en una frase por que el cielo es azul. ".repeat(8).trimEnd();

async function shot(page: Page, name: string) {
  const dir = process.env.BOT_SCREENSHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  const device = test.info().project.name === "phone-webkit" ? "iphone-webkit" : "desktop";
  await page.screenshot({ path: join(dir, device + "-" + name + ".png"), scale: "css", animations: "disabled" });
}

async function openCodex(page: Page) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const agent = { ...fixtureAgents[0]!, agent: "codex", kind: "agent" as const, status: "idle" as const, surface: { ...DRAFT, composer: "empty" as const, revision: 1 },
    hasSession: true, paneLabel: "codexp", terminalId: "send-reliability-codex" };
  const snapshot = { ...fixtureSnapshot, agents: [agent], shellPanes: [], ts: Date.now(),
    device: { authorized: true, enforced: true, device: "Campo" } };
  const world = await installPaneWorld(page, { paneId: agent.paneId, snapshot,
    chat: { ...fixtureKiroChat, paneId: agent.paneId },
    screens: { idle: paneCapture("codex--v0157-idle-50"), draft: readFileSync(new URL("../../bridge/surface/captures/codex--v0172-typed-question-lead--w56.txt", import.meta.url), "utf8") }, start: "idle" });
  const posts: string[] = [];
  await page.route(url => url.pathname === "/api/send", async route => {
    // SAFETY: this isolated browser's only caller is lib/api.ts's Send Protocol request.
    const body = route.request().postDataJSON() as { id: string; text: string };
    posts.push(body.text);
    // The bridge left the text in Codex's box: the screen shows the draft from here on.
    world.show("draft");
    await route.fulfill({ json: sendAnswer(body.id, "typed_not_submitted", "mismatch", { offers: ["submit", "discard", "keys"], rowsHash: "rows-1", surface: DRAFT }) });
  });
  await page.goto("/pane/" + encodeURIComponent(agent.paneId));
  const field = page.locator('[data-slot="composer-box"] textarea').first();
  await expect(field).toBeVisible();
  return { field, posts };
}

test("after a send left in Codex's box, the Spanish draft notice floats above the composer and the field stays usable", async ({ page }) => {
  const { field, posts } = await openCodex(page);
  await field.fill("?" + LONG);
  await page.locator('[data-slot="composer-primary"]').click();
  await expect.poll(() => posts.length).toBe(1);
  const notice = page.locator('[data-slot="terminal-draft-notice"]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Borrador en la terminal");
  await expect(notice.getByRole("button", { name: "Retomar" })).toBeVisible();
  await shot(page, "draft-notice");
  // The notice never covers the field: their boxes do not meet, and a plain tap reaches the field.
  const box = await page.locator('[data-slot="composer-box"]').first().boundingBox();
  const card = await notice.boundingBox();
  if (box === null || card === null) throw new Error("both boxes must be measurable");
  expect(card.y + card.height).toBeLessThanOrEqual(box.y + 1);
  await field.click();
  await field.pressSequentially("sigo escribiendo");
  await expect(field).toHaveValue(/sigo escribiendo/u);
  // The x puts it away.
  await notice.getByRole("button", { name: "Cerrar el aviso del borrador en la terminal" }).click();
  await expect(notice).toBeHidden();
  await shot(page, "draft-notice-dismissed");
});
