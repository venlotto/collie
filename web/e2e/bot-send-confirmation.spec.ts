import { expect as baseExpect, test, type Page } from "@playwright/test";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot, sendAnswer } from "@/test/handlers";
import type { Surface } from "@/lib/surface/surface";
import type { TranscriptEntry } from "@/lib/types";
import { installApiStub, installPaneWorld, paneCapture, pinLocale } from "./fixtures/api";

const expect = baseExpect.configure({ timeout: 15_000 });
test.use({ serviceWorkers: "block" });
const PROMPT = "Revisa el inicio de la ronda.\nComprueba también la despedida.";
const UNKNOWN: Surface = { revision: 0, turn: "unknown", modal: "unknown", composer: "unknown" };
const IDLE: Surface = { revision: 0, turn: "idle", modal: "none", composer: "empty" };

async function setup(page: Page, hasSession = true) {
  await pinLocale(page, "en");
  await installApiStub(page);
  const agent = { ...fixtureAgents[0]!, agent: "codex", hasSession, surface: IDLE, status: hasSession ? "idle" as const : "done" as const,
    paneLabel: "Confirmation", terminalId: "confirmation-codex" };
  const snapshot = { ...fixtureSnapshot, agents: [agent], shellPanes: [], ts: Date.now(),
    device: { authorized: true, enforced: true, device: "Campo" } };
  if (fixtureKiroChat.page !== "live") throw new Error("Expected live fixture");
  const upserts: (TranscriptEntry & { seq: number })[] = [];
  const chat = { ...fixtureKiroChat, paneId: agent.paneId, head: 0, oldest: 0, upserts };
  await installPaneWorld(page, { paneId: agent.paneId, snapshot, chat,
    screens: { idle: paneCapture("codex--v0157-idle-50") }, start: "idle" });
  let screenText = paneCapture("codex--v0157-idle-50");
  await page.route(url => url.pathname === `/api/pane/${encodeURIComponent(agent.paneId)}`, route => route.fulfill({ json: { paneId: agent.paneId, text: screenText, truncated: false, revision: 0 } }));
  const posts: string[] = [];
  let outcome = "unknown";
  await page.route(url => url.pathname === "/api/send", async route => {
    // SAFETY: only the app Send Protocol client posts to this isolated fixture route.
    const body = route.request().postDataJSON() as { id: string; text: string };
    posts.push(body.text);
    await route.fulfill({ json: sendAnswer(body.id, outcome, outcome === "unknown" ? "no_evidence" : "unconfirmed", { surface: UNKNOWN }) });
  });
  await page.goto("/");
  await page.locator(".bot-row").first().click();
  const field = page.locator('[data-slot="composer-box"] textarea').first();
  await expect(field).toBeVisible();
  return { agent, field, posts, refuse() { outcome = "refused"; }, uncertain() { outcome = "unknown"; }, readable() { screenText += "\nA new readable screen"; agent.surface = IDLE; }, land() {
    agent.hasSession = true;
    chat.rev++;
    chat.head = 2;
    chat.oldest = 1;
    chat.upserts = [
      { seq: 1, uuid: "new-user", ts: new Date().toISOString(), role: "user", parts: [{ kind: "text", text: PROMPT.repeat(4) }] },
      { seq: 2, uuid: "new-assistant", ts: new Date().toISOString(), role: "assistant", parts: [{ kind: "text", text: "Recibido y comprobado." }] },
    ];
  } };
}

for (const newDraft of [false, true]) {
  test(`journal confirms repeated prompt without resending; newer draft ${newDraft ? "kept" : "absent"}`, async ({ page }) => {
    const world = await setup(page);
    await world.field.fill(PROMPT);
    await page.locator('[data-slot="composer-primary"]').click();
    await expect.poll(() => world.posts.length).toBe(1);
    await expect(page.getByRole("button", { name: "It arrived", exact: true })).toBeVisible();
    await expect(world.field).toHaveValue(PROMPT);
    if (newDraft) await world.field.fill("Una instrucción nueva, todavía sin enviar.");
    world.land();
    await expect(page.locator(".bot-turn-reply").getByText("Recibido y comprobado.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "It arrived", exact: true })).toHaveCount(0);
    await expect(world.field).toHaveValue(newDraft ? "Una instrucción nueva, todavía sin enviar." : "");
    await expect(page.locator(".bot-terminal")).toHaveCount(0);
    expect(world.posts).toEqual([PROMPT]);
    await page.screenshot({ path: test.info().outputPath("confirmed.png") });
  });
}

test("Messages stays selected while an existing Codex pane has no session yet", async ({ page }) => {
  const world = await setup(page, false);
  await expect(page.locator(".bot-terminal")).toHaveCount(0);
  await world.field.fill(PROMPT);
  await page.locator('[data-slot="composer-primary"]').click();
  await expect(page.getByRole("button", { name: "It arrived", exact: true })).toBeVisible();
  await expect(page.locator(".bot-terminal")).toHaveCount(0);
  world.land();
  await expect(page.locator(".bot-turn-reply").getByText("Recibido y comprobado.", { exact: true })).toBeVisible();
  await expect(world.field).toHaveValue("");
});

test("readable screen retires unread recovery even when Herdr revision stays zero", async ({ page }) => {
  const world = await setup(page);
  world.refuse();
  await world.field.fill(PROMPT);
  await page.locator('[data-slot="composer-primary"]').click();
  await expect(page.getByText("Collie cannot read this screen. You can.", { exact: true })).toBeVisible();
  world.readable();
  await expect(page.getByText("Collie cannot read this screen. You can.", { exact: true })).toHaveCount(0);
  await expect(world.field).toHaveValue(PROMPT);
  expect(world.posts).toEqual([PROMPT]);
});


test("explicit Terminal shows one screen alongside delivery controls", async ({ page }) => {
  const world = await setup(page);
  await page.getByRole("button", { name: "Opciones del chat" }).click();
  await page.getByRole("radiogroup", { name: "View", exact: true }).getByRole("radio", { name: "Terminal", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".bot-terminal")).toBeVisible();
  await world.field.fill(PROMPT);
  await page.locator('[data-slot="composer-primary"]').click();
  await expect(page.getByRole("button", { name: "It arrived", exact: true })).toBeVisible();
  await expect(page.getByText(/directory: \/tmp\/collie-canary-project/)).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("single-terminal.png") });
  expect(world.posts).toEqual([PROMPT]);
});


test("a later delivery replaces an earlier unread refusal", async ({ page }) => {
  const world = await setup(page);
  world.refuse();
  await world.field.fill(PROMPT);
  await page.locator('[data-slot="composer-primary"]').click();
  const unread = page.getByText("Collie cannot read this screen. You can.", { exact: true });
  await expect(unread).toBeVisible();
  world.uncertain();
  await page.locator('[data-slot="composer-primary"]').click();
  await expect(page.getByRole("button", { name: "It arrived", exact: true })).toBeVisible();
  await expect(unread).toHaveCount(0);
  world.land();
  await expect(world.field).toHaveValue("");
  await expect(page.getByRole("button", { name: "It arrived", exact: true })).toHaveCount(0);
  expect(world.posts).toEqual([PROMPT, PROMPT]);
});
