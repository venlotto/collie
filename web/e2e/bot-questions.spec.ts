// QUESTIONS IN A BOT'S MESSAGES, AND "NEEDS YOU" ONLY WHEN ONE WAITS (Koperca catalogue C and D,
// 2026-11-27). Every screen is a real capture from the corpus; the Codex 0.172.0 ones were taken on a
// disposable Herdr pane. The bridge is stubbed, so the statuses are the ones the bridge sends: the "false
// Needs you" case runs the bridge's own rule (bridge/blocked-settle.ts) over the catalogue's Surface.
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { settleBlocked } from "../../bridge/blocked-settle";
import { queuedQuestion } from "@/lib/pending-question";
import type { AgentView, TranscriptEntry } from "@/lib/types";
import type { Surface } from "@/lib/surface/surface";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot } from "@/test/handlers";
import { installApiStub, installPaneWorld, paneCapture, pinLocale, type PaneStep } from "./fixtures/api";

const expect = baseExpect.configure({ timeout: 15_000 });
test.use({ serviceWorkers: "block" });

const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function journal(harness: "codex" | "claude"): TranscriptEntry[] {
  const reader = fileURLToPath(new URL("./fixtures/bot-journal.mjs", import.meta.url));
  return JSON.parse(execFileSync("bun", [reader, harness], { encoding: "utf8" }));
}

async function shot(page: Page, name: string) {
  const dir = process.env.BOT_SCREENSHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  const device = test.info().project.name === "phone-webkit" ? "iphone" : "desktop";
  await page.screenshot({ path: join(dir, device + "-" + name + ".png"), scale: "css", animations: "disabled" });
}

interface Setup {
  readonly harness: "codex" | "claude";
  readonly status: AgentView["status"];
  readonly screens: Readonly<Record<string, string>>;
  readonly start: string;
  readonly surface: Surface;
  readonly script?: readonly PaneStep[];
  readonly title?: string;
}

async function setup(page: Page, s: Setup) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const agent: AgentView = { ...fixtureAgents[1]!, agent: s.harness, hasSession: true, status: s.status, paneLabel: "codexp",
    terminalId: "questions-" + s.harness, lastActiveAt: Date.now() - 5_000, lastSeenAt: Date.now() - 1_000, surface: s.surface };
  if (s.title !== undefined) agent.terminalTitle = s.title;
  const snapshot = { ...fixtureSnapshot, agents: [agent], shellPanes: [], ts: Date.now(),
    device: { authorized: true, enforced: true, device: "Campo" } };
  const entries = journal(s.harness);
  if (fixtureKiroChat.page !== "live") throw new Error("Expected a live chat fixture");
  const world = await installPaneWorld(page, { paneId: agent.paneId, snapshot,
    chat: { ...fixtureKiroChat, head: entries.length, oldest: 1, upserts: entries.map((entry, i) => Object.assign({}, entry, { seq: i + 1 })) },
    screens: s.screens, start: s.start, script: s.script ?? [] });
  return { agent, world };
}

async function openBot(page: Page) {
  await page.goto("/");
  await page.locator(".bot-row").first().click();
  await expect(page.getByRole("button", { name: "Opciones del chat" })).toBeVisible();
}

async function chooseTerminal(page: Page) {
  await page.getByRole("button", { name: "Opciones del chat" }).click();
  const group = page.getByRole("radiogroup", { name: "Vista", exact: true });
  await group.getByRole("radio", { name: "Terminal", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".bot-terminal")).toBeVisible();
}

const RUNNING_FREE: Surface = { revision: 1, turn: "running", modal: "none", composer: "empty" };
const ACTION_REQUIRED = "[ ! ] Action Required | Ordena workspace y personaliza bots | repos";

test("falso «Te necesita»: blocked por el título y la pantalla sin pregunta se muestra trabajando", async ({ page }) => {
  // The catalogue's pane: Herdr said blocked from Codex's title, the Surface read a running turn and a free
  // box, and nothing was queued. The bridge's rule settles it before the phone ever sees it.
  const screen = paneCapture("codex--v0172-async-answered--w52");
  const rows = screen.split(/\r?\n/).map((row) => row.replace(SGR, ""));
  const status = settleBlocked(RUNNING_FREE, queuedQuestion(rows) !== null) ?? "blocked";
  expect(status).toBe("working");
  await setup(page, { harness: "codex", status, screens: { now: screen }, start: "now", surface: RUNNING_FREE, title: ACTION_REQUIRED });
  await page.goto("/");
  const row = page.locator(".bot-row").first();
  await expect(row).toContainText("Trabajando");
  await expect(row).not.toContainText("Te necesita");
  await shot(page, "falso-needs-you-lista");
  await row.click();
  await expect(page.getByRole("button", { name: "Opciones del chat" })).toBeVisible();
  await expect(page.getByText("El agente te hizo una pregunta")).toHaveCount(0);
  await expect(page.locator('[data-slot="card-dock"] button')).toHaveCount(0);
  await shot(page, "falso-needs-you-chat");
});

test("«1 question» de Codex: Te necesita, tarjeta en Mensajes, Responder abre la pregunta y una opción la contesta", async ({ page }) => {
  const queued = paneCapture("codex--v0172-async-question--w52");
  const rows = queued.split(/\r?\n/).map((row) => row.replace(SGR, ""));
  // The same rule keeps the pane blocked while the question waits.
  expect(settleBlocked(RUNNING_FREE, queuedQuestion(rows) !== null)).toBeNull();
  const { agent, world } = await setup(page, {
    harness: "codex", status: "blocked", start: "queued", surface: RUNNING_FREE, title: ACTION_REQUIRED,
    screens: { queued, panel: paneCapture("codex--v0172-async-panel--w52"), answered: paneCapture("codex--v0172-async-answered--w52") },
    script: [{ on: "queued", keys: ["shift+Left"], to: "panel" }, { on: "panel", keys: ["2"], to: "answered" }],
  });
  await page.goto("/");
  await expect(page.locator(".bot-row").first()).toContainText("Te necesita");
  await shot(page, "codex-question-lista");
  await page.locator(".bot-row").first().click();

  await expect(page.getByText("El agente te hizo una pregunta")).toBeVisible();
  await expect(page.getByText("Tabs or spaces?").last()).toBeVisible();
  // The box keeps the keys while the question waits: a message can still be typed.
  await expect(page.locator('[data-slot="composer-box"] textarea').first()).toBeEditable();
  await shot(page, "codex-question-tarjeta");

  await page.getByRole("button", { name: "Responder", exact: true }).click();
  await expect.poll(() => world.sent.map((s) => s.keys.join("+"))).toEqual(["shift+Left"]);
  // Bound to the reminder and the box under it, never to the count row's ticking age.
  expect(world.sent[0]!.expected_prompt).toContain("shift+← to answer");

  const spaces = page.getByRole("button", { name: /Spaces/ });
  await expect(spaces).toBeVisible();
  await expect(page.getByRole("button", { name: /Tabs/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^.?\s*Other/ })).toHaveCount(0);
  await shot(page, "codex-question-opciones");

  await spaces.click();
  await expect.poll(() => world.sent.map((s) => s.keys.join("+"))).toEqual(["shift+Left", "2"]);
  await expect(page.getByText("Enviado")).toBeVisible();
  Object.assign(agent, { status: "working" });
  await expect(spaces).toHaveCount(0);
  await expect(page.getByText("El agente te hizo una pregunta")).toHaveCount(0);
  await shot(page, "codex-question-respondida");
});

test("«2 questions» de Codex: la tarjeta nombra las dos y se contestan en orden, cada una con su título y sus opciones", async ({ page }) => {
  // Real captures of one request_user_input_async call with two questions (scratch tmux, 52 columns): the
  // reminder, the first opened, and the second as it opened after the first was answered.
  const { agent, world } = await setup(page, {
    harness: "codex", status: "blocked", start: "reminder", surface: RUNNING_FREE, title: ACTION_REQUIRED,
    screens: {
      reminder: paneCapture("codex--v0172-async-two-reminder--w52"),
      first: paneCapture("codex--v0172-async-two-panel--w52"),
      second: paneCapture("codex--v0172-async-other-sent--w52"),
      answered: paneCapture("codex--v0172-async-answered--w52"),
    },
    script: [{ on: "reminder", keys: ["shift+Left"], to: "first" }, { on: "first", keys: ["1"], to: "second" }, { on: "second", keys: ["2"], to: "answered" }],
  });
  await openBot(page);
  await expect(page.getByText("El agente te hizo 2 preguntas")).toBeVisible();
  const titles = page.locator('[data-slot="prompt-question"]').filter({ hasText: "Pet?" });
  await expect(titles.last()).toContainText("Day?");
  await shot(page, "codex-dos-preguntas-tarjeta");

  await page.getByRole("button", { name: "Responder", exact: true }).click();
  await expect.poll(() => world.sent.map((s) => s.keys.join("+"))).toEqual(["shift+Left"]);
  const cat = page.getByRole("button", { name: /Cat/ });
  await expect(cat).toBeVisible();
  await expect(page.getByRole("button", { name: /Dog/ })).toBeVisible();
  await expect(page.getByText(/Pregunta 1 de 2/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Escriba su propia respuesta" })).toBeVisible();
  await shot(page, "codex-dos-preguntas-primera");

  await cat.click();
  await expect.poll(() => world.sent.map((s) => s.keys.join("+"))).toEqual(["shift+Left", "1"]);
  const tue = page.getByRole("button", { name: /Tue/ });
  await expect(tue).toBeVisible();
  await expect(cat).toHaveCount(0);
  await expect(page.getByText(/Pregunta 1 de 2/)).toHaveCount(0);
  await shot(page, "codex-dos-preguntas-segunda");

  await tue.click();
  await expect.poll(() => world.sent.map((s) => s.keys.join("+"))).toEqual(["shift+Left", "1", "2"]);
  Object.assign(agent, { status: "working" });
  await expect(tue).toHaveCount(0);
  await expect(page.getByText(/El agente te hizo/)).toHaveCount(0);
  await shot(page, "codex-dos-preguntas-respondidas");
});

test("«Other» de Codex: un campo de texto en la tarjeta elige Other, escribe la respuesta y la envía con Enter", async ({ page }) => {
  // The `Other` captures (scratch tmux, 52 columns), one run: the digit puts the pointer on the row, the
  // typed words stand in the faint label's place, Enter sends them and the next question opens.
  const opened = paneCapture("codex--v0172-async-two-panel--w52");
  const { world } = await setup(page, {
    harness: "codex", status: "blocked", start: "opened", surface: RUNNING_FREE, title: ACTION_REQUIRED,
    screens: {
      opened,
      focused: paneCapture("codex--v0172-async-other-focused--w52"),
      typed: paneCapture("codex--v0172-async-other-typed--w52"),
      sent: paneCapture("codex--v0172-async-other-sent--w52"),
    },
    script: [{ on: "opened", keys: ["3"], to: "focused" }, { on: "typed", keys: ["Enter"], to: "sent" }],
  });
  const replies: { text: string; submit: boolean }[] = [];
  // The typed words go through the reply route unsubmitted; the terminal then shows them in the row.
  await page.route((url) => url.pathname.endsWith("/reply"), async (route) => {
    replies.push(route.request().postDataJSON());
    world.show("typed");
    await route.fulfill({ json: { ok: true } });
  });
  await openBot(page);
  await expect(page.getByRole("button", { name: /Cat/ })).toBeVisible();
  await page.getByRole("button", { name: "Escriba su propia respuesta" }).click();
  const field = page.getByRole("textbox", { name: "Texto de la respuesta" });
  await field.fill("Fish 42, maybe 3");
  await shot(page, "codex-other-campo");
  await page.getByRole("button", { name: "Enviar respuesta" }).click();
  await expect.poll(() => world.sent.map((s) => s.keys.join("+"))).toEqual(["3", "Enter"]);
  expect(replies).toEqual([expect.objectContaining({ text: "Fish 42, maybe 3", submit: false })]);
  await expect(page.getByText("Respuesta enviada")).toBeVisible();
  // The next question of the run opens on its own card.
  await expect(page.getByRole("button", { name: /Tue/ })).toBeVisible();
  await shot(page, "codex-other-enviado");
});

test("vista Terminal: la pregunta encolada de Codex queda a la vista como tarjeta, sin perderse por el scroll", async ({ page }) => {
  await setup(page, { harness: "codex", status: "blocked", start: "queued", surface: RUNNING_FREE, title: ACTION_REQUIRED,
    screens: { queued: paneCapture("codex--v0172-async-question--w52") } });
  await openBot(page);
  await chooseTerminal(page);
  const answer = page.getByRole("button", { name: "Responder", exact: true });
  await expect(answer).toBeVisible();
  await expect(answer).toBeInViewport();
  await expect(page.getByText("El agente te hizo una pregunta")).toBeInViewport();
  await shot(page, "codex-question-terminal");
});

test("permiso de Codex (Trust and continue): se ve en Mensajes y en Terminal y se responde con un toque", async ({ page }) => {
  const ask = { id: "ask-trust", kind: "permission" as const, channel: "keys" as const, hash: "trusthash",
    options: [{ id: "1", label: "Trust and continue" }, { id: "2", label: "Back to Agent Command Center" }] };
  const { agent } = await setup(page, { harness: "codex", status: "blocked", start: "trust",
    screens: { trust: paneCapture("codex--v0172-trust--w52"), idle: paneCapture("codex--v0172-async-answered--w52") },
    surface: { revision: 1, turn: "unknown", modal: { ask }, composer: "unknown" } });
  const answers: unknown[] = [];
  await page.route((url) => url.pathname === "/api/ask/ask-trust", async (route) => {
    answers.push(route.request().postDataJSON());
    await route.fulfill({ json: { outcome: "sent" } });
  });
  await openBot(page);
  const trust = page.getByRole("button", { name: /Trust and continue/ });
  await expect(trust).toBeVisible();
  await shot(page, "trust-mensajes");
  await chooseTerminal(page);
  await expect(trust).toBeVisible();
  await expect(trust).toBeInViewport();
  await shot(page, "trust-terminal");
  await trust.click();
  await expect.poll(() => answers.length).toBe(1);
  expect(answers[0]).toMatchObject({ pane: agent.paneId, hash: "trusthash", optionId: "1", origin: "person_tap" });
});

test("elección múltiple (casillas) de Claude: cada opción es un botón y marcarla envía su tecla", async ({ page }) => {
  const { world } = await setup(page, { harness: "claude", status: "blocked", start: "multi",
    screens: { multi: paneCapture("claude--select-multiselect-checked") },
    surface: { revision: 1, turn: "unknown", modal: "unreadable", composer: "unknown" } });
  await openBot(page);
  const peppers = page.getByRole("checkbox", { name: /Peppers/ }).or(page.getByRole("button", { name: /Peppers/ })).first();
  await expect(peppers).toBeVisible();
  await expect(page.getByText(/Mushrooms/).last()).toBeVisible();
  await shot(page, "claude-casillas");
  await peppers.click();
  await expect.poll(() => world.sent.length).toBeGreaterThan(0);
  expect(world.sent.at(-1)!.keys).toContain("4");
});

test("pregunta con campo de texto de Claude: opciones tocables y una respuesta propia se ven en Mensajes", async ({ page }) => {
  const { world } = await setup(page, { harness: "claude", status: "blocked", start: "form",
    screens: { form: paneCapture("claude--v2283-ask-two-line-question") },
    surface: { revision: 1, turn: "unknown", modal: "unreadable", composer: "unknown" } });
  await openBot(page);
  await expect(page.getByText(/Which fruit do you want\?/).last()).toBeVisible();
  const banana = page.getByRole("button", { name: /Banana/ });
  await expect(banana).toBeEnabled();
  await expect(page.getByRole("button", { name: "Escriba su propia respuesta" })).toBeVisible();
  await shot(page, "claude-formulario");
  await banana.click();
  await expect.poll(() => world.sent.length).toBeGreaterThan(0);
  expect(world.sent[0]!.keys).toContain("2");
});

test.describe("escritorio con varias ventanas", () => {
  test.beforeEach(() => test.skip(test.info().project.name === "phone-webkit", "the desk is a wide-screen layout"));
  test.use({ viewport: { width: 1600, height: 950 } });

  test("una ventana sin foco que espera una pregunta lo dice, y el toque la trae con su tarjeta", async ({ page }) => {
    await pinLocale(page, "es");
    await installApiStub(page);
    const queued = paneCapture("codex--v0172-async-question--w52");
    const asking: AgentView = { ...fixtureAgents[1]!, agent: "codex", paneLabel: "Pregunta", hasSession: true, status: "blocked",
      terminalId: "desk-q", focused: false, surface: RUNNING_FREE, terminalTitle: ACTION_REQUIRED };
    const quiet: AgentView = { ...fixtureAgents[0]!, agent: "codex", paneLabel: "Tranquilo", hasSession: true, status: "idle",
      terminalId: "desk-i", focused: false, surface: { ...RUNNING_FREE, turn: "idle" } };
    const snapshot = { ...fixtureSnapshot, agents: [asking, quiet], shellPanes: [], ts: Date.now(),
      device: { authorized: true, enforced: true, device: "Campo" } };
    const entries = journal("codex");
    if (fixtureKiroChat.page !== "live") throw new Error("Expected a live chat fixture");
    const chat = { ...fixtureKiroChat, head: entries.length, oldest: 1, upserts: entries.map((entry, i) => Object.assign({}, entry, { seq: i + 1 })) };
    await installPaneWorld(page, { paneId: asking.paneId, snapshot, chat, screens: { queued }, start: "queued" });
    await installPaneWorld(page, { paneId: quiet.paneId, snapshot, chat, screens: { idle: paneCapture("codex--v0172-async-answered--w52") }, start: "idle" });
    await page.goto("/");
    await page.locator(".bot-row").filter({ hasText: "Pregunta" }).click();
    await expect(page.getByRole("button", { name: "Volver a los chats" })).toBeVisible();
    await page.locator(".bot-row").filter({ hasText: "Tranquilo" }).click();
    await expect(page.getByRole("button", { name: "Minimizar" })).toHaveCount(2);
    const peek = page.getByRole("region", { name: /Pregunta/ });
    const waiting = peek.getByRole("button", { name: "Te espera una pregunta · Responder" });
    await expect(waiting).toBeVisible();
    await expect(page.getByRole("region", { name: /Tranquilo/ }).getByRole("button", { name: /Te espera una pregunta/ })).toHaveCount(0);
    await shot(page, "escritorio-ventana-espera");
    await waiting.click();
    await expect(peek.getByText("El agente te hizo una pregunta")).toBeVisible();
    await expect(peek.getByRole("button", { name: "Responder", exact: true })).toBeVisible();
    await shot(page, "escritorio-ventana-tarjeta");
  });
});
