import { readFileSync } from "node:fs";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { TranscriptEntry } from "@/lib/types";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot, sendAnswer } from "@/test/handlers";
import { installApiStub, installPaneWorld, pinLocale } from "./fixtures/api";
const expect = baseExpect.configure({ timeout: 15_000 });
const PNG = readFileSync(new URL("./fixtures/attachments/photo-small.png", import.meta.url));
const saved = "/home/ubuntu/.local/state/collie/uploads/term.fixture.mwz50y8g-12345678.png";
async function open(page: Page, status = 200, entries: TranscriptEntry[] = []) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const agent = { ...fixtureAgents[0]!, agent: "kiro", hasSession: true, status: "idle" as const,
    surface: { revision: 1, turn: "idle" as const, modal: "none" as const, composer: "empty" as const } };
  await installPaneWorld(page, { paneId: agent.paneId,
    snapshot: { ...fixtureSnapshot, agents: [agent], shellPanes: [] },
    chat: { ...fixtureKiroChat, ...(entries && { head: entries.length, oldest: 1, upserts: entries.map((entry, i) => ({ ...entry, seq: i + 1 })) }) }, screens: { idle: "Kiro> " }, start: "idle" });
  await page.route("**/api/config*", route => route.fulfill({ json: { push: false, vapidPublicKey: "",
    upload: { maxBytes: 10 * 1024 * 1024, imageTypes: ["png"], textTypes: ["txt"] } } }));
  const sizes: number[] = [];
  await page.route(/\/api\/pane\/[^/]+\/upload(?:\?|$)/, async route => {
    sizes.push(route.request().postDataBuffer()?.length ?? 0);
    await route.fulfill(status === 200 ? { json: { ok: true, path: saved } }
      : { status, contentType: "text/html", body: "<h1>Bad Gateway</h1>" });
  });
  await page.route("**/api/attachments/*", route => route.fulfill({ json: { name: "photo-small.png", image: true } }));
  await page.route("**/api/attachments/*/image", route => route.fulfill({ body: PNG, contentType: "image/png" }));
  await page.route("**/api/send", async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: sendAnswer(body.id, "sent") });
  });
  await page.goto("/pane/" + encodeURIComponent(agent.paneId));
  await expect(page.getByRole("textbox")).toBeVisible();
  return sizes;
}
async function shot(page: Page, name: string) {
  const dir = process.env.ATTACHMENT_SHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${test.info().project.name}-${name}.png`), animations: "disabled", scale: "css" });
}
async function photo(page: Page, size: number) {
  const buffer = Buffer.alloc(size); PNG.copy(buffer);
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "photo-large.png", mimeType: "image/png", buffer });
}
async function attach(page: Page) {
  await page.getByRole("dialog").getByRole("button", { name: "Adjuntar", exact: true }).click();
}
test("desktop file drop shares the editor and supports multiple files", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "Desktop drag-and-drop");
  const sizes = await open(page);
  const transfer = await page.evaluateHandle(bytes => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], "photo-small.png", { type: "image/png" }));
    data.items.add(new File(["nota"], "nota.txt", { type: "text/plain" }));
    return data;
  }, [...PNG]);
  const box = page.locator('[data-slot="composer-box"]');
  await box.dispatchEvent("dragover", { dataTransfer: transfer });
  await box.dispatchEvent("drop", { dataTransfer: transfer });
  await shot(page, "drop-before-confirm");
  await attach(page);
  await expect(page.getByRole("textbox")).toHaveValue("[Image #1] [File #2] ");
  expect(sizes).toHaveLength(2);
  await shot(page, "drop-chips");
});
test("8 MiB photo keeps its bytes through Attach and appears in the sent bubble", async ({ page }) => {
  const sizes = await open(page);
  await photo(page, 8 * 1024 * 1024);
  await attach(page);
  await expect(page.getByRole("textbox")).toHaveValue("[Image #1] ");
  expect(sizes).toHaveLength(1);
  await shot(page, "large-chip");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  const bubble = page.locator(".bot-turn-user").last();
  await expect(bubble).toBeVisible();
  await expect(bubble).not.toContainText("/uploads/");
  await expect(bubble.getByRole("img", { name: "photo-small.png" })).toBeVisible();
  await shot(page, "sent-photo");
});
for (const code of [502, 409]) test(`upload ${code} after editor shows error and releases spinner`, async ({ page }) => {
  await open(page, code);
  await photo(page, 8 * 1024 * 1024);
  await attach(page);
  await expect(page.getByRole("button", { name: "Adjuntar archivo", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert").filter({ hasText: String(code) })).toBeVisible();
  await shot(page, `error-${code}`);
});
test("oversize and unsupported PDF show truthful errors without uploading", async ({ page }) => {
  const sizes = await open(page);
  await photo(page, 11 * 1024 * 1024);
  await expect(page.getByText("El archivo supera los 10 MB, el límite en este collie.", { exact: true })).toBeVisible();
  await shot(page, "oversize");
  await page.locator('input[type="file"]').last().setInputFiles({ name: "documento.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") });
  await expect(page.getByText("Collie no puede adjuntar documento.pdf.", { exact: true })).toBeVisible();
  expect(sizes).toHaveLength(0);
  await shot(page, "pdf");
});

test("stored user turns keep a photo preview and text filename after reload", async ({ page }) => {
  const textPath = saved.replace(".png", ".txt");
  await open(page, 200, [{ uuid: "upload-user", role: "user", ts: "2026-11-27T15:00:00Z",
    parts: [{ kind: "text", text: `${saved} ${textPath} Revisa estos adjuntos` }] }]);
  await page.route("**/api/attachments/*.txt", route => route.fulfill({ json: { name: "nota.txt", image: false } }));
  await page.reload();
  const bubble = page.locator(".bot-turn-user").last();
  await expect(bubble).not.toContainText("/uploads/");
  await expect(bubble.getByRole("img", { name: "photo-small.png" })).toBeVisible();
  await expect(bubble).toContainText("nota.txt");
  await expect(bubble).toContainText("Revisa estos adjuntos");
  await shot(page, "history");
});
