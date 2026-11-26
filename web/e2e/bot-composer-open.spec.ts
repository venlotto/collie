import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { paneScopeKey } from "@/lib/scope";
import type { Surface } from "@/lib/surface/surface";
import type { AgentStatus, AgentView } from "@/lib/types";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot, sendAnswer } from "@/test/handlers";
import { installApiStub, installPaneWorld, paneCapture, pinLocale } from "./fixtures/api";

const FREE: Surface = { revision: 1, turn: "idle", modal: "none", composer: "empty" };
const RUNNING: Surface = { revision: 2, turn: "running", modal: "none", composer: "empty" };
const STARTING: Surface = { revision: 0, turn: "unknown", modal: "unknown", composer: "unknown", reason: "no-match" };
const ASK: Surface = {
  revision: 3,
  turn: "idle",
  composer: "unknown",
  modal: { ask: { id: "trust", kind: "permission", channel: "keys", hash: "abc", options: [{ id: "1", label: "Trust, continue" }] } },
};

interface PostedSend {
  id: string;
  pane: string;
  text: string;
  mode: string;
  when?: string;
}

interface StateOptions {
  status: AgentStatus;
  surface: Surface;
  screen: string;
  run?: NonNullable<AgentView["agentRun"]>;
  starting?: boolean;
}

async function openState(page: Page, options: StateOptions) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const run = options.run;
  const agent: AgentView = {
    ...fixtureAgents[0]!,
    agent: run ? "shell" : "kiro",
    kind: run ? "shell" : "agent",
    status: options.status,
    surface: options.surface,
    hasSession: true,
    paneLabel: run ? "plan-sync-bnc-nexo" : "Informes",
    workspaceLabel: "Noviembre",
    agentRun: run,
  };
  const workspace = { ...fixtureSnapshot.workspaces[0]!, label: agent.workspaceLabel };
  const snapshot = { ...fixtureSnapshot, agents: run ? [] : [agent], shellPanes: run ? [agent] : [],
    workspaces: [workspace], ts: Date.now(), device: { enforced: true, authorized: true, device: "Fixture" } };
  const world = await installPaneWorld(page, {
    paneId: agent.paneId,
    snapshot,
    chat: { ...fixtureKiroChat, paneId: agent.paneId },
    screens: { idle: options.screen },
    start: "idle",
  });
  if (run) {
    const virtual = "agent-run:" + run.id;
    await page.route(url => url.pathname === "/api/pane/" + encodeURIComponent(virtual) + "/chat",
      route => route.fulfill({ json: { ...fixtureKiroChat, paneId: virtual } }));
  }
  const sends: PostedSend[] = [];
  await page.route(url => url.pathname === "/api/send", async route => {
    // SAFETY: this isolated browser's only caller is lib/api.ts's Send Protocol request.
    const body = route.request().postDataJSON() as PostedSend;
    sends.push(body);
    await route.fulfill({ json: sendAnswer(body.id, "sent", undefined, { queued: options.surface.turn === "running" }) });
  });
  await page.goto("/pane/" + encodeURIComponent(agent.paneId));
  if (options.starting) {
    const agentLaunch = { id: "fixture-start", paneKey: paneScopeKey(undefined, agent.paneId), harness: "kiro" };
    await page.evaluate(launch => {
      history.replaceState({ idx: 0, usr: { agentLaunch: launch } }, "");
    }, agentLaunch);
    await page.reload();
  }
  const field = page.getByRole("textbox");
  await expect(field).toBeVisible({ timeout: 15_000 });
  return { agent, field, sends, world };
}

async function typeAndShot(page: Page, state: string, words: string) {
  const field = page.getByRole("textbox");
  await expect(field).toBeEditable();
  await expect(field).not.toHaveAttribute("readonly");
  await field.click();
  await field.pressSequentially(words);
  await expect(field).toHaveValue(words);
  const primary = page.locator('[data-slot="composer-box"] > button').last();
  const action = await primary.boundingBox();
  const textFit = await primary.evaluate(button => ({ client: button.clientWidth, scroll: button.scrollWidth }));
  // TOOLBAR_TAP_TARGET's invisible 4px reach is included in scrollWidth; a longer label is not.
  expect(textFit.scroll).toBeLessThanOrEqual(textFit.client + 4);
  const viewport = page.viewportSize();
  if (action === null || viewport === null) throw new Error("The primary action and viewport must be measurable");
  expect(action.x).toBeGreaterThanOrEqual(0);
  expect(action.x + action.width).toBeLessThanOrEqual(viewport.width);
  const directory = process.env.BOT_SCREENSHOTS;
  if (directory) {
    await mkdir(directory, { recursive: true });
    const device = test.info().project.name === "phone-webkit" ? "iphone-webkit" : "desktop";
    await page.screenshot({ path: join(directory, device + "-" + state + ".png"), scale: "css", animations: "disabled" });
  }
  return field;
}

test("done: the composer types and Send uses the ordinary protocol", async ({ page }) => {
  const { sends } = await openState(page, { status: "done", surface: FREE, screen: paneCapture("kiro--v3-idle-w120") });
  await typeAndShot(page, "done", "Sigue con el informe");
  const send = page.getByRole("button", { name: "Enviar", exact: true });
  await expect(send).toBeEnabled();
  await expect(send).not.toHaveAttribute("aria-disabled");
  await send.click();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0]).toMatchObject({ pane: "w1:p1", text: "Sigue con el informe", mode: "send" });
  await expect(page.getByText(/Collie no puede leer esta pantalla/)).toHaveCount(0);
});

test("idle: the composer types and Send delivers", async ({ page }) => {
  const { sends } = await openState(page, { status: "idle", surface: FREE, screen: paneCapture("kiro--v3-idle-w120") });
  await typeAndShot(page, "idle", "Prepara el resumen");
  const send = page.getByRole("button", { name: "Enviar", exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0]).toMatchObject({ pane: "w1:p1", text: "Prepara el resumen", mode: "send" });
});

test("working: a physical agent run sends through the existing queue", async ({ page }) => {
  const now = Date.now();
  const { sends } = await openState(page, { status: "working", surface: RUNNING, screen: paneCapture("kiro--v3-idle-w120"),
    run: { id: "working-run", status: "running", start: now - 60_000, end: null } });
  await expect(page.getByText(/Corriendo ·/)).toBeVisible();
  await typeAndShot(page, "working", "Encola esta revisión");
  const send = page.getByRole("button", { name: "Enviar", exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0]).toMatchObject({ pane: "w1:p1", text: "Encola esta revisión", mode: "send" });
});

test("starting: the draft stays editable and Send is not held by the phone", async ({ page }) => {
  const { sends } = await openState(page, { status: "unknown", surface: STARTING, screen: "$ kiro", starting: true });
  await typeAndShot(page, "starting", "Draft durante el arranque");
  const send = page.getByRole("button", { name: "Enviar", exact: true });
  await expect(send).toBeEnabled();
  await expect(send).not.toHaveAttribute("aria-disabled");
  await send.click();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0]).toMatchObject({ pane: "w1:p1", text: "Draft durante el arranque", mode: "send" });
  await expect(page.getByText(/Collie no puede leer esta pantalla/)).toHaveCount(0);
});

test("needs-you: typing stays open and Send goes to the protected dialog answer", async ({ page }) => {
  const { sends } = await openState(page, { status: "blocked", surface: ASK, screen: paneCapture("kiro--v3-workspace-trust-continue-w120") });
  const answers: unknown[] = [];
  await page.route(url => url.pathname === "/api/ask/trust", async route => {
    answers.push(route.request().postDataJSON());
    await route.fulfill({ json: { outcome: "sent" } });
  });
  await typeAndShot(page, "needs-you", "Confío en esta carpeta");
  const answerSlot = page.getByRole("button", { name: "Responder al diálogo", exact: true });
  await expect(answerSlot).toBeEnabled();
  await answerSlot.click();
  expect(sends).toEqual([]);
  const option = page.getByRole("button", { name: "Trust, continue", exact: true });
  await expect(option).toBeFocused();
  await option.click();
  await expect.poll(() => answers.length).toBe(1);
  expect(answers[0]).toMatchObject({ pane: "w1:p1", hash: "abc", optionId: "1", origin: "person_tap" });
  expect(sends).toEqual([]);
});

test("stopped: a shell-backed done run offers a new chat and never writes to the log viewer", async ({ page }) => {
  const now = Date.now();
  const { sends, world } = await openState(page, { status: "done", surface: STARTING, screen: "tail -F agent.log",
    run: { id: "finished-run", status: "done", start: now - 9 * 60_000, end: now } });
  await expect(page.getByRole("main").getByText(/Listo · 9 min/)).toBeVisible();
  await expect(page.getByText("El agente terminó. Abre un chat nuevo para continuar.")).toBeVisible();
  const before = page.url();
  await typeAndShot(page, "stopped", "Continuar sin tocar la shell");
  expect(page.url()).toBe(before);
  expect(sends).toEqual([]);
  expect(world.writes).toEqual([]);
  const action = page.getByRole("button", { name: "Abrir chat nuevo", exact: true });
  await expect(action).toBeEnabled();
  await action.click();
  await expect(page).toHaveURL(/\/new\?pane=w1%3Ap1|[?&]over=%2Fnew%3Fpane%3Dw1%253Ap1/);
  expect(sends).toEqual([]);
  expect(world.writes).toEqual([]);
});
