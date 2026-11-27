// CLAUDE'S QUESTIONS IN A BOT'S MESSAGES (Koperca catalogue C, 2026-11-27). AskUserQuestion with two
// questions, Claude Code 2.1.332 in a 54-column, 23-row Herdr pane: every screen is a real capture from a
// disposable pane (fixtures claude--v21332-wizard-*--w54). At that width the select footer wraps onto two
// rows and the field's `ctrl+g to edit in Vim` hint re-flows it, which used to refuse the typed answer
// after its digit had gone in; and 2.1.332's review step lost its "Ready to submit" line, which used to
// leave the last step unread. The bridge is stubbed: the screen follows the keys the app sends.
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AgentView, TranscriptEntry } from "@/lib/types";
import type { Surface } from "@/lib/surface/surface";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot } from "@/test/handlers";
import { installApiStub, installPaneWorld, pinLocale } from "./fixtures/api";

const expect = baseExpect.configure({ timeout: 15_000 });
test.use({ serviceWorkers: "block" });

// Kept out of the `panes/` corpus (see the folder's README): read by path, not by `paneCapture`.
const capture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../src/fixtures/claude-v21332-narrow/claude--v21332-wizard-${name}--w54.txt`, import.meta.url)), "utf8");

function journal(): TranscriptEntry[] {
  const reader = fileURLToPath(new URL("./fixtures/bot-journal.mjs", import.meta.url));
  return JSON.parse(execFileSync("bun", [reader, "claude"], { encoding: "utf8" }));
}

async function shot(page: Page, name: string) {
  const dir = process.env.BOT_SCREENSHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  const device = (page.viewportSize()?.width ?? 0) >= 1000 ? "desktop" : "iphone";
  await page.screenshot({ path: join(dir, device + "-" + name + ".png"), scale: "css", animations: "disabled" });
}

/** The Surface the bridge reads off the first step: a keys-channel question ask, as in the catalogue. */
const ASKED: Surface = {
  revision: 1,
  turn: "unknown",
  modal: {
    ask: {
      id: "ask-pet",
      kind: "question",
      options: [{ id: "1", label: "Cat" }, { id: "2", label: "Dog" }, { id: "3", label: "Chat about this" }],
      channel: "keys",
      hash: "pethash",
    },
  },
  composer: "unknown",
};

async function openClaudeBot(page: Page) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const agent: AgentView = { ...fixtureAgents[1]!, agent: "claude", hasSession: true, status: "blocked", paneLabel: "claudep",
    terminalId: "questions-claude", lastActiveAt: Date.now() - 5_000, lastSeenAt: Date.now() - 1_000, surface: ASKED };
  const snapshot = { ...fixtureSnapshot, agents: [agent], shellPanes: [], ts: Date.now(),
    device: { authorized: true, enforced: true, device: "Campo" } };
  const entries = journal();
  if (fixtureKiroChat.page !== "live") throw new Error("Expected a live chat fixture");
  const world = await installPaneWorld(page, { paneId: agent.paneId, snapshot,
    chat: { ...fixtureKiroChat, head: entries.length, oldest: 1, upserts: entries.map((entry, i) => Object.assign({}, entry, { seq: i + 1 })) },
    screens: {
      pet: capture("narrow-unfocused"),
      day: capture("narrow-day-unfocused"),
      dayFocused: capture("narrow-day-field-focused"),
      dayTyped: capture("narrow-day-field-typed"),
      review: capture("review-cat"),
      answered: capture("answered"),
    },
    start: "pet",
    script: [
      { on: "pet", keys: ["1"], to: "day" },
      { on: "day", keys: ["3"], to: "dayFocused" },
      { on: "dayTyped", keys: ["Enter"], to: "review" },
      { on: "review", keys: ["1"], to: "answered" },
    ],
  });
  const replies: { text: string; submit: boolean }[] = [];
  // The typed words go through the reply route unsubmitted; the terminal then shows them in the row.
  await page.route((url) => url.pathname.endsWith("/reply"), async (route) => {
    replies.push(route.request().postDataJSON());
    world.show("dayTyped");
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await page.locator(".bot-row").first().click();
  await expect(page.getByRole("button", { name: "Opciones del chat" })).toBeVisible();
  return { world, replies };
}

for (const [label, viewport] of [["iPhone", { width: 390, height: 844 }], ["escritorio", { width: 1280, height: 800 }]] as const) test.describe(label, () => {
test.use({ viewport });
test("AskUserQuestion de Claude a 54 columnas: Cat avanza, «Other» envía y la revisión se contesta en Mensajes", async ({ page }) => {
  const { world, replies } = await openClaudeBot(page);

  // Pet?: one tap on Cat sends its digit, and the card moves to Day? without the terminal.
  await expect(page.getByText("¿Pet?")).toBeVisible();
  await shot(page, "claude-q-pet");
  await page.getByRole("button", { name: /Cat/ }).click();
  await expect.poll(() => world.sent.map((s) => s.keys.join("+"))).toEqual(["1"]);
  await expect(page.getByText("¿Day?")).toBeVisible();
  await shot(page, "claude-q-day");

  // Day?: Other, a text, Send answer. The digit, the text, then ONE Enter, and the review opens.
  await page.getByRole("button", { name: "Escriba su propia respuesta" }).click();
  await page.getByRole("textbox", { name: "Texto de la respuesta" }).fill("Fish 42, maybe 3");
  await shot(page, "claude-q-other-typed");
  await page.getByRole("button", { name: "Enviar respuesta" }).click();
  await expect.poll(() => world.sent.map((s) => s.keys.join("+"))).toEqual(["1", "3", "Enter"]);
  expect(replies).toEqual([expect.objectContaining({ text: "Fish 42, maybe 3", submit: false })]);
  await expect(page.getByText("Respuesta enviada")).toBeVisible();

  // The review step is a card too: both answers, and one tap submits them.
  await expect(page.getByText("Fish 42, maybe 3").last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar respuestas" })).toBeVisible();
  await expect(page.getByText("Collie no puede leer esta pantalla. Tú sí.")).toHaveCount(0);
  await shot(page, "claude-q-review");
  await page.getByRole("button", { name: "Enviar respuestas" }).click();
  await expect.poll(() => world.sent.map((s) => s.keys.join("+"))).toEqual(["1", "3", "Enter", "1"]);
  await expect(page.getByRole("button", { name: "Enviar respuestas" })).toHaveCount(0);
  await shot(page, "claude-q-answered");
});
});
