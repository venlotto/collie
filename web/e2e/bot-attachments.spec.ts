import { readFileSync } from "node:fs";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PaneChatResponse, TranscriptEntry } from "@/lib/types";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot, sendAnswer } from "@/test/handlers";
import { installApiStub, installPaneWorld, pinLocale } from "./fixtures/api";
const expect = baseExpect.configure({ timeout: 15_000 });
const PNG = readFileSync(new URL("./fixtures/attachments/photo-small.png", import.meta.url));
const codexHistoryPane = readFileSync(new URL("./fixtures/attachments/codex-history-pane.txt", import.meta.url), "utf8");
const codexHistoryWrap = readFileSync(new URL("./fixtures/attachments/codex-history-well-wrap.txt", import.meta.url), "utf8");
const saved = "/home/ubuntu/.local/state/collie/uploads/term.fixture.mwz50y8g-12345678.png";
async function open(page: Page, status = 200, entries: TranscriptEntry[] = [], harness = "kiro",
  screen = "Kiro> ", chat?: Extract<PaneChatResponse, { available: false }>) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const agent = { ...fixtureAgents[0]!, agent: harness, hasSession: true, status: "idle" as const,
    surface: { revision: 1, turn: "idle" as const, modal: "none" as const, composer: "empty" as const } };
  const liveChat: PaneChatResponse = chat ?? { ...fixtureKiroChat, page: "live", rev: 1,
    head: entries.length, oldest: 1, upserts: entries.map((entry, i) => ({ ...entry, seq: i + 1 })) };
  await installPaneWorld(page, { paneId: agent.paneId,
    snapshot: { ...fixtureSnapshot, agents: [agent], shellPanes: [] },
    chat: liveChat, screens: { idle: screen }, start: "idle" });
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
function uploadTurn(uuid: string, text: string): TranscriptEntry {
  return { uuid, role: "user", ts: "2026-11-27T17:00:00Z",
    parts: [{ kind: "text", text: `${text} COL-21 retest: describe la foto adjunta y para.` }] };
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

test("Codex Mensajes renders whole and terminal-wrapped upload paths as named photos", async ({ page }) => {
  const codexPath = "/home/ubuntu/.local/state/collie/uploads/term.dd6ec3955c53ba9d4dd7652681c869d822f259447f3ee5be8e617aebd13620a7.mwz88mwb-270abe08.png";
  const wrapped = codexPath.match(/.{1,44}/gu)!.join("\n");
  await open(page, 200, [uploadTurn("codex-whole", codexPath), uploadTurn("codex-wrapped", wrapped)], "codex");
  const bubbles = page.locator(".bot-turn-user");
  await expect(bubbles).toHaveCount(2);
  await expect(page.locator(".bot-terminal")).toHaveCount(0);
  await expect(bubbles.getByRole("img", { name: "photo-small.png" })).toHaveCount(2);
  for (const bubble of await bubbles.all()) {
    await expect(bubble).not.toContainText("/home/ubuntu/.local/state/collie/uploads/");
    await expect(bubble).toContainText("photo-small.png");
    await expect(bubble).toContainText("COL-21 retest: describe la foto adjunta y para.");
  }
  await shot(page, "codex-history");
});

test("Codex Mensajes uses a short chip when the attachment sidecar is gone", async ({ page }) => {
  const id = "term.dd6ec3955c53ba9d4dd7652681c869d822f259447f3ee5be8e617aebd13620a7.mwz88mwb-270abe08.png";
  await open(page, 200, [uploadTurn("codex-pruned", `/home/ubuntu/.local/state/collie/uploads/${id}`)], "codex");
  await page.route(`**/api/attachments/${id}`, route => route.fulfill({ status: 404, json: { error: "pruned" } }));
  await page.reload();
  const bubble = page.locator(".bot-turn-user").last();
  await expect(bubble.locator('[data-slot="sent-attachment"]')).toContainText("270abe08.png");
  await expect(bubble).not.toContainText(id);
  await expect(bubble).not.toContainText("/home/ubuntu/.local/state/collie/uploads/");
  await expect(bubble).toContainText("COL-21 retest: describe la foto adjunta y para.");
  await shot(page, "codex-history-fallback");
});

test("Codex Mensajes lifts a persisted upload echo out of the terminal after reload", async ({ page }) => {
  await open(page, 200, [], "codex", codexHistoryPane,
    { paneId: fixtureAgents[0]!.paneId, available: false, reason: "no-log" });
  await page.reload();
  const bubble = page.locator(".bot-turn-user").last();
  await expect(bubble).toBeVisible();
  await expect(bubble.getByRole("img", { name: "photo-small.png" })).toBeVisible();
  await expect.poll(() => bubble.getByRole("img", { name: "photo-small.png" })
    .evaluate((img) => img instanceof HTMLImageElement ? img.naturalWidth : 0)).toBeGreaterThan(0);
  await expect(bubble).toContainText("photo-small.png");
  await expect(bubble).toContainText("COL-21: responde OK y para.");
  await expect(page.locator(".bot-detail")).not.toContainText("/home/ubuntu/.local/state/collie/uploads/");
  await expect(page.locator(".bot-terminal")).toContainText("• OK");
  await shot(page, "codex-terminal-history");
  await page.getByRole("button", { name: "Opciones del chat" }).click();
  await page.getByRole("radiogroup", { name: "Vista", exact: true })
    .getByRole("radio", { name: "Terminal", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".bot-terminal")).toContainText("/home/ubuntu/.local/state/collie/uploads/");
  await expect(page.locator(".bot-turn-user")).toHaveCount(0);
});

test("Codex Mensajes reassembles a persisted upload echo wrapped by the input well", async ({ page }) => {
  await open(page, 200, [], "codex", codexHistoryWrap.trimEnd(),
    { paneId: fixtureAgents[0]!.paneId, available: false, reason: "no-log" });
  await page.reload();
  const bubble = page.locator(".bot-turn-user").last();
  await expect(bubble).toBeVisible();
  await expect(bubble.getByRole("img", { name: "photo-small.png" })).toBeVisible();
  await expect.poll(() => bubble.getByRole("img", { name: "photo-small.png" })
    .evaluate((img) => img instanceof HTMLImageElement ? img.naturalWidth : 0)).toBeGreaterThan(0);
  await expect(bubble).toContainText("photo-small.png");
  await expect(bubble).toContainText("COL-21: responde OK y para.");
  await expect(page.locator(".bot-detail")).not.toContainText("/home/ubuntu/.local/state/collie/uploads/");
  await shot(page, "codex-terminal-history-wrap");
});

test("a pending Codex send in Terminal uses the same attachment renderer", async ({ page }) => {
  await open(page, 200, [], "codex");
  await page.getByRole("button", { name: "Opciones del chat" }).click();
  const view = page.getByRole("radiogroup", { name: "Vista", exact: true });
  await view.getByRole("radio", { name: "Terminal", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".bot-terminal")).toBeVisible();
  await page.getByRole("textbox").fill("COL-21 provisional");
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "photo-small.png", mimeType: "image/png", buffer: PNG });
  await attach(page);
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  const bubble = page.locator('[data-slot="mirror-pending"]');
  await expect(bubble).toBeVisible();
  await expect(bubble).not.toContainText("/home/ubuntu/.local/state/collie/uploads/");
  await expect(bubble.getByRole("img", { name: "photo-small.png" })).toBeVisible();
  await expect(bubble).toContainText("COL-21 provisional");
  await shot(page, "codex-pending-terminal");
});
