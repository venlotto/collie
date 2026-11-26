import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixtureAgents, fixtureKiroChat, fixtureLaunchedTab, fixtureSnapshot, fixtureWalkyAgent, paneTextWithDraft } from "@/test/handlers";
import type { AgentView } from "@/lib/types";
import { installApiStub, installLauncherWorld, installPaneWorld, paneCapture, pinLocale } from "./fixtures/api";
import { botMotionMidpoint } from "./fixtures/bot-motion";
import { expectBotSheetPosition } from "./fixtures/bot-sheet";

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page }, info) => {
  const phone = info.project.name.includes("phone");
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1280, height: 800 });
  await pinLocale(page, "es");
});

async function screenshot(page: Page, label: string) {
  const dir = process.env.BOT_SCREENSHOTS;
  if (!dir) return;
  const project = test.info().project.name;
  const prefix = project.includes("desktop") ? "escritorio" : project.includes("webkit") ? "iphone-webkit" : project.includes("phone") ? "movil" : "escritorio";
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, prefix + "-" + label + ".png"), scale: "css", animations: "disabled" });
}

async function settledSheet(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Crear nuevo Bot" });
  await expect(dialog).toBeVisible();
  // WebKit can defer the first animation frame. Wait for the resting form itself.
  await expectBotSheetPosition(dialog);
  const geometry = await dialog.evaluate(el => {
    const face = el.querySelector(".bot-preview .bot-avatar")!.getBoundingClientRect();
    const field = el.querySelector("input")!.getBoundingClientRect();
    const form = el.querySelector("form")!;
    return { gap: field.top - face.bottom, faceSize: face.height,
      centerOffset: (field.left + field.right - face.left - face.right) / 2,
      transform: getComputedStyle(form).transform, surface: getComputedStyle(form).backgroundColor };
  });
  expect(geometry.gap).toBeGreaterThan(0);
  expect(geometry.faceSize).toBeGreaterThan(0);
  expect(Math.abs(geometry.centerOffset)).toBeLessThan(1);
  expect(geometry.transform).toBe("none");
  expect(geometry.surface).toBe("rgb(28, 28, 30)");
  if (process.env.BOT_SCREENSHOTS) {
    const dir = process.env.BOT_SCREENSHOTS;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, test.info().project.name + "-" + test.info().title.split(" ")[0] + "-sheet.json"), JSON.stringify(geometry, null, 2));
  }
  return dialog;
}

test("workspace list, chat input and bot creation", async ({ page }) => {
  await installApiStub(page);
  const launch = await installLauncherWorld(page);
  const now = Date.now();
  const names = ["Kanban · Orquestador", "Kanban · Menú y Updates", "Kanban · Puente OpenBot", "Kanban · Multicuenta", "Duck Race · Rooms", "Orquestador Duck", "Duck Race · Backend", "Duck Race · Diseño", "Duck Race · Plan", "Viajes", "Itinerario", "Reservas", "Rutas", "Hoteles", "Equipaje", "Calendario", "Guías", "Archivo"];
  const previews = ["¿Subo el nuevo menú de Kanban a producción?", "¿Cómo lo pasamos a producción?", "Ya le avisé a Kanban · Orquestador del cierre.", "Mensaje de Aviso de agentes", "El diseño de las salas ya está listo.", "Le escribió a Duck Race · Rooms", "La revisión terminó.", "Ya está lista la propuesta.", "Revisamos las reglas de juego.", "Reunión del domingo"];
  const sections = ["Kanban agents", "Duck duck race", "Viajes"];
  const panes: AgentView[] = names.map((name, i) => {
    const group = i < 4 ? 0 : i < 9 ? 1 : 2;
    const space = "w" + (group + 1);
    return Object.assign({}, fixtureAgents[0]!, { paneId: space + ":p" + (i + 1), workspaceId: space, workspaceLabel: sections[group]!, paneLabel: name, agent: "kiro", hasSession: true, hint: previews[i] ?? "Última actualización del viaje.", status: "idle" as const, focused: i === 0, lastActiveAt: now - (i + 1) * 60000, lastSeenAt: [0, 4, 5, 12, 16, 17].includes(i) ? now - 3600000 : now });
  });
  const deviceName = test.info().project.name.includes("phone") ? "campo" : "árbol";
  const snapshot = { ...fixtureSnapshot, device: { enforced: true, authorized: true, device: deviceName }, agents: panes, shellPanes: [], workspaces: sections.map((label, i) => ({ ...fixtureSnapshot.workspaces[0]!, workspaceId: "w" + (i + 1), label })), ts: now };
  const peer = Object.assign({}, fixtureWalkyAgent, {
    at: now, from: { ...fixtureWalkyAgent.from, label: "Avisos de agentes" }, body: "¿Qué falta para subirlo?",
  });
  await page.route(url => url.pathname.endsWith("/walky"), route => route.fulfill({ json: { messages: [peer] } }));
  const messages = ["¿Ya está listo el cambio del menú?", "Ya está listo el cambio del menú: los enlaces de Discord y GitHub están visibles y el botón de actualizar se oculta. Lo puedes ver en la instancia de prueba.", `[walky-talky ${peer.id}] from agent Avisos de agentes`, "Primero haré un respaldo del volumen de datos de Kanban. Después cambiaré la imagen y reiniciaré el servicio."];
  const upserts = messages.map((text, i) => ({ uuid: "test-" + i, ts: new Date(now - (4-i) * 2000000).toISOString(), role: i % 2 === 0 ? "user" as const : "assistant" as const, parts: [{ kind: "text" as const, text }], seq: i + 1 }));
  if (fixtureKiroChat.page !== "live") throw new Error("Expected a live chat fixture");
  const world = await installPaneWorld(page, { paneId: panes[0]!.paneId, snapshot, chat: { ...fixtureKiroChat, oldest: 1, head: 4, upserts }, start: "approval", screens: { idle: paneCapture("kiro--v3-idle-w120"), approval: paneCapture("kiro--v3-approval-allow-w120") },
    script: [{ on: "approval", keys: ["Enter"], to: "idle" }] });
  await page.goto("/");
  const rows = page.locator(".bot-row");
  await expect(rows).toHaveCount(names.length);
  await expect(page.getByRole("img", { name: deviceName })).toHaveText(deviceName === "campo" ? "C" : "Á");
  await expect(page.locator(".bot-unread")).toHaveCount(6);
  await expect(page.locator(".bot-row .bot-line svg")).toHaveCount(names.length);
  const down = page.locator(".bot-jump-down");
  await expect(down).toBeVisible();
  await screenshot(page, "lista");
  await down.click();
  await expect(page.locator(".bot-jump-up")).toBeVisible();
  expect(await page.locator(".bot-featured").evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThan(0);
  await expect(page.locator(".bot-user")).toBeInViewport();
  await expect(page.locator(".bot-bar").first().locator(".bot-pill")).toHaveCount(0);
  await screenshot(page, "lista-scroll");
  await page.locator(".bot-scroll").evaluate(el => el.scrollTo(0, 0));
  await page.getByRole("button", { name: sections[0], exact: true }).click();
  await expect(rows).toHaveCount(names.length - 4);
  const search = page.getByRole("searchbox", { name: "Buscar" });
  await search.fill("Puente");
  await expect(rows).toHaveCount(1);
  await search.fill("");
  await page.getByRole("button", { name: sections[0], exact: true }).click();
  await rows.first().click();
  // The list preview can already show this message while the pane loader is pending.
  const detail = page.locator(".bot-detail");
  await expect(detail.getByText(messages[3]!, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(detail.getByText("Nuevos", { exact: true })).toBeVisible();
  await expect(page.getByText("4 mensajes con 2 Bots")).toBeAttached();
  await expect(page.getByText("Mensaje de Avisos de agentes", { exact: true })).toBeAttached();
  await expect(page.locator(".bot-attribution").filter({ hasText: "Mensaje de" }).last()).toBeVisible();
  await expect(page.locator(".bot-attribution").filter({ hasText: "Escribió a" }).first()).toBeAttached();
  const choices = page.locator('[data-slot="prompt-options"]');
  await expect(choices.getByRole("button", { name: "Allow", exact: true })).toBeVisible();
  await screenshot(page, "acciones");
  await choices.getByRole("button", { name: "Allow", exact: true }).click();
  await expect.poll(() => world.sent.map(write => write.keys)).toEqual([["Enter"]]);
  await expect(choices).toHaveCount(0);
  await expect(page.locator('[data-slot="composer-mic-draft"]')).toBeVisible();
  await expect(page.locator('[data-slot="composer-primary"] svg.lucide-audio-lines')).toBeVisible();
  if (test.info().project.name.includes("phone")) {
    const covered = await page.locator(".bot-jump").evaluateAll(chips => chips.every(chip => {
      const box = chip.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest(".bot-detail");
    }));
    expect(covered).toBe(true);
  }
  await screenshot(page, "conversacion");
  if (process.env.BOT_SCREENSHOTS && test.info().project.name === "desktop") {
    for (const [width, height] of [[768, 1024], [1920, 1080]] as const) {
      await page.setViewportSize({ width, height });
      await screenshot(page, "chat-" + width);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  const input = page.locator('[data-slot="composer-box"] textarea').first();
  await input.fill("Recibido");
  const posted = page.waitForRequest(r => r.method() === "POST" && /\/(reply|send)$/.test(r.url()));
  if (test.info().project.name.includes("phone")) await page.locator('[data-slot="composer-primary"]').click();
  else await input.press("Enter");
  expect((await posted).postDataJSON().text).toBe("Recibido");
  await page.getByRole("button", { name: "Opciones del chat" }).click();
  await page.getByRole("button", { name: "Ver terminal" }).click();
  await expect(page.locator(".bot-terminal")).toBeVisible();
  await page.getByRole("button", { name: "Volver a los chats" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Crear nuevo", exact: true }).click();
  const dialog = await settledSheet(page);
  await expect(dialog.getByRole("button", { name: "Crear", exact: true })).toBeDisabled();
  await screenshot(page, "crear");
  await dialog.getByRole("button", { name: "Forma 4", exact: true }).click();
  await dialog.getByRole("button", { name: "Verde", exact: true }).click();
  await dialog.getByRole("textbox").fill("Bitácora");
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await expect.poll(() => launch.launches.length).toBe(1);
  await expect(page.locator(".bot-chat-bar strong")).toHaveText("Bitácora");
  expect(launch.launches[0]?.body.paneId).toBe(panes[0]!.paneId);
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(fixtureLaunchedTab.pane.paneId)));
});

for (const pairedGate of [false, true]) {
  test(pairedGate ? "unpaired device keeps navigation" : "sign-in keeps navigation", async ({ page }) => {
    await installApiStub(page);
    await page.route(url => url.pathname === "/api/snapshot", route => route.fulfill({
      status: 403, contentType: "text/plain", body: pairedGate ? "device not paired" : "Access refused",
    }));
    await page.goto("/");
    const notice = page.locator(".bot-index .bot-access");
    await expect(notice.getByRole("link")).toHaveAttribute("href", pairedGate ? /settings/ : /auth\/$/);
    const search = page.getByRole("searchbox");
    await search.fill("Kanban");
    await search.fill("");
    await expect(page.getByRole("img", { name: "Perfil" })).toHaveText("");
    expect(await page.locator(".bot-bar").evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(
      await notice.evaluate(el => el.getBoundingClientRect().top));
    await screenshot(page, pairedGate ? "sin-emparejar" : "sign-in");
    await page.getByRole("button", { name: "Crear nuevo", exact: true }).click();
    const sheet = await settledSheet(page);
    await expect(notice).toBeHidden();
    await expect(sheet.locator(".bot-access, [role=status], a")).toHaveCount(0);
    await screenshot(page, pairedGate ? "crear-sin-emparejar" : "crear-sign-in");
    await sheet.getByRole("textbox").fill("Bitácora");
    await expect(sheet.getByRole("button", { name: "Crear", exact: true })).toBeDisabled();
    await sheet.getByRole("button", { name: "Cerrar" }).click();
    await expect(notice.getByRole("link")).toBeVisible();
    await search.fill("Kanban");
  });
}

for (const inset of [0, 34]) {
  test(`phone stack and sheet keep the footers in place (inset ${inset || "native"})`, async ({ page, browserName }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    if (inset && browserName === "chromium") {
      const client = await page.context().newCDPSession(page);
      await client.send("Emulation.setSafeAreaInsetsOverride", { insets: { bottom: inset } });
    } else if (inset) {
      // Playwright WebKit has no physical home indicator. Supply its clearance in the first stylesheet.
      await page.route(/\.css$/, async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: await response.text() + "\n[data-bots] { --bot-bottom: 34px; }" });
      });
    }
    await installApiStub(page);
    const panes = Array.from({ length: 18 }, (_, i) => ({
      ...fixtureAgents[0]!, paneId: "w1:p" + (i + 1), paneLabel: "Kanban " + (i + 1),
    }));
    const pane = panes[0]!;
    await installPaneWorld(page, {
      paneId: pane.paneId, snapshot: { ...fixtureSnapshot, agents: panes, shellPanes: [], ts: Date.now() },
      chat: { paneId: pane.paneId, available: false, reason: "no-session" },
      start: "idle", screens: { idle: paneTextWithDraft() },
    });
    await page.goto("/");
    const row = page.locator(".bot-row").filter({ has: page.getByText(pane.paneLabel, { exact: true }) });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await page.locator(".bot-scroll").evaluate(el => { el.scrollTop = 60; });
    const shell = await page.locator("[data-bots]").elementHandle();
    const list = await page.locator(".bot-scroll").elementHandle();

    const start = await page.evaluateHandle(() => {
      const stack = document.querySelector<HTMLElement>(".bot-layout")!;
      const scroll = stack.querySelector(".bot-scroll")!;
      const panel = stack.querySelector("main")!;
      const search = stack.querySelector(".bot-search")!;
      const surface = stack.querySelector(".bot-list-surface")!;
      const frames: { ms: number; open: boolean; x: number; sheet: string; scale: number; searchTop: number; search: number; composerTop: number | null; composer: number | null; scroll: number }[] = [];
      const t0 = performance.now();
      let raf = 0;
      function sample() {
        const box = panel.querySelector('[data-slot="composer-box"]')?.getBoundingClientRect();
        const rect = search.getBoundingClientRect();
        const dialog = stack.querySelector<HTMLElement>("dialog[open]");
        frames.push({ ms: performance.now() - t0, open: stack.dataset.detail === "true",
          x: panel.getBoundingClientRect().left - stack.getBoundingClientRect().left,
          sheet: dialog ? dialog.dataset.leaving === "true" ? "closing" : "open" : "closed",
          scale: surface.getBoundingClientRect().width / stack.clientWidth,
          searchTop: rect.top, search: rect.bottom, composerTop: box?.height ? box.top : null, composer: box?.height ? box.bottom : null,
          scroll: scroll.scrollTop });
        raf = requestAnimationFrame(sample);
      }
      sample();
      return () => { cancelAnimationFrame(raf); return frames; };
    });
    const dir = process.env.BOT_SCREENSHOTS;
    const openSheet = () => page.getByRole("button", { name: "Crear nuevo", exact: true }).click();
    const closeSheet = () => page.getByRole("button", { name: "Cerrar", exact: true }).click();
    const back = async () => {
      if (inset) await page.goBack();
      else await page.getByRole("button", { name: "Volver a los chats" }).click();
    };
    await row.click();
    const field = page.locator('[data-slot="composer-box"] textarea').first();
    await expect(field).toBeInViewport({ timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector(".bot-detail")!.getBoundingClientRect().left === document.querySelector(".bot-layout")!.getBoundingClientRect().left);
    const composer = await field.elementHandle();
    await back();
    await expect(page).toHaveURL(/\/$/);
    await page.waitForFunction(() => document.querySelector(".bot-detail")!.getBoundingClientRect().left >= document.querySelector(".bot-layout")!.getBoundingClientRect().right);
    const surface = page.locator(".bot-list-surface");
    await openSheet();
    await expect.poll(() => surface.evaluate(el => el.getBoundingClientRect().width / el.clientWidth)).toBeCloseTo(0.96, 3);
    await closeSheet();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => surface.evaluate(el => el.getBoundingClientRect().width / el.clientWidth)).toBe(1);
    // Include the settled frame after the sheet has gone.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const frames = await start.evaluate(finish => finish());
    if (dir) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${test.info().project.name}-frames-${inset || "native"}.json`), JSON.stringify(frames, null, 2));
    }
    const width = await page.locator(".bot-layout").evaluate(el => el.clientWidth);
    expect(width).toBe(390);
    expect(await shell?.evaluate(el => el.isConnected)).toBe(true);
    expect(await list?.evaluate(el => el.isConnected)).toBe(true);
    expect(await composer?.evaluate(el => el.isConnected)).toBe(true);
    const slides = [true, false].map(open => frames.filter(f => f.open === open && f.x > 0 && f.x < width));
    for (const moving of slides) expect(moving.every(f => f.composer !== null)).toBe(true);
    if (slides.some(moving => moving.length === 0)) {
      const panel = page.locator(".bot-detail");
      for (const action of [() => row.click(), back]) {
        const mid = await botMotionMidpoint(panel, action);
        expect(mid.x).toBeGreaterThan(0);
        expect(mid.x).toBeLessThan(width);
        expect(mid.composerHeight).toBeGreaterThan(0);
      }
    }
    expect(frames[0]!.scroll).toBeGreaterThan(0);
    expect(new Set(frames.map(f => f.scroll)).size).toBe(1);
    expect(new Set(frames.map(f => f.search)).size).toBe(1);
    expect(new Set(frames.map(f => f.searchTop)).size).toBe(1);
    const sampled = ["open", "closing"].every(phase =>
      frames.some(f => f.sheet === phase && f.scale > .961 && f.scale < .999));
    if (!sampled) {
      for (const action of [openSheet, closeSheet]) {
        const mid = await botMotionMidpoint(surface, action);
        expect(mid.scale).toBeGreaterThan(.961);
        expect(mid.scale).toBeLessThan(.999);
      }
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    const composerTops = frames.flatMap(f => f.composerTop === null ? [] : [f.composerTop]);
    expect(Math.max(...composerTops) - Math.min(...composerTops)).toBeLessThan(0.51);
    const composerEdges = frames.flatMap(f => f.composer === null ? [] : [f.composer]);
    expect(Math.max(...composerEdges) - Math.min(...composerEdges)).toBeLessThan(0.51);
    if (inset) expect(frames[0]!.search).toBeCloseTo(page.viewportSize()!.height - 34, 1);
    // Take bursts on a second traversal: PNG encoding stalls WebKit’s animation-frame callbacks.
    const burst = async (direction: string, action: () => Promise<void>) => {
      if (!dir) return;
      const folder = join(dir, "brinco", test.info().project.name + "-" + (inset || "native"), direction);
      await mkdir(folder, { recursive: true });
      const shot = (i: number) => page.screenshot({ path: join(folder, String(i).padStart(2, "0") + ".png"), scale: "css" });
      await shot(0);
      await Promise.all([action(), (async () => {
        await page.waitForFunction(phase => {
          const stack = document.querySelector<HTMLElement>(".bot-layout")!;
          if (phase === "abrir") return !!stack.querySelector("dialog[open]");
          if (phase === "cerrar") return !stack.querySelector("dialog[open][data-leaving=false]");
          return stack.dataset.detail === String(phase === "ida");
        }, direction);
        const begin = Date.now();
        for (let i = 1; Date.now() - begin < 540; i++) await shot(i);
      })()]);
    };
    if (dir) {
      await burst("ida", () => row.click());
      await burst("vuelta", back);
      await burst("abrir", openSheet);
      await burst("cerrar", closeSheet);
    }
  });
}

test("the same open terminal, draft and selection cross the split breakpoint", async ({ page }) => {
  await installApiStub(page);
  const pane = { ...fixtureAgents[0]!, agent: "kiro", paneLabel: "Revisión de rutas", hasSession: true };
  const rows = Array.from({ length: 18 }, (_, i) => ({
    ...pane, paneId: "w1:p" + (i + 1), hasSession: i === 0,
    terminalId: "ruta-" + i, paneLabel: i === 0 ? pane.paneLabel : "Itinerario " + i,
  }));
  // Short lines keep the same reading position across widths. More than a screenful
  // makes scrolling back measurable even on the 1080px monitor.
  const stops = ["Maracay", "Mérida", "Barinas", "Valencia", "Caracas", "Maturín"];
  const output = ["$ itinerarios verificar", " ", "   RUTA     DESTINO     ESTADO", ...Array.from({ length: 120 }, (_, i) => {
    const route = String(i + 1).padStart(3, "0");
    return "   Ruta " + route + "   " + stops[i % stops.length]!.padEnd(10) + "  \x1b[32m✓ lista\x1b[0m";
  })].join("\n");
  await installPaneWorld(page, {
    paneId: pane.paneId, chat: fixtureKiroChat,
    snapshot: { ...fixtureSnapshot, agents: rows, shellPanes: [], ts: Date.now(),
      device: { enforced: true, authorized: true, device: "Prueba" } },
    screens: { idle: output + "\n" + paneCapture("kiro--v3-idle-w120") }, start: "idle",
  });
  await page.route("**/api/chat-order*", route => route.fulfill({ json: [] }));
  const otherPane = rows[1]!;
  await page.route(url => url.pathname === "/api/pane/" + encodeURIComponent(otherPane.paneId),
    route => route.fulfill({ json: { paneId: otherPane.paneId, text: output, truncated: false, revision: 1 } }));
  await page.route(url => url.pathname === "/api/pane/" + encodeURIComponent(otherPane.paneId) + "/chat",
    route => route.fulfill({ json: { ...fixtureKiroChat, paneId: otherPane.paneId } }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const sidebar = page.locator(".bot-sidebar");
  const detail = page.locator(".bot-detail");
  const empty = page.locator(".bot-detail-empty");
  const footer = page.locator(".bot-search-foot");
  await expect(empty).toBeInViewport();
  await expect(empty).toContainText("Selecciona un chat");
  const first = sidebar.locator(".bot-row").filter({ hasText: pane.paneLabel });
  const other = sidebar.locator(".bot-row").filter({ has: page.getByText("Itinerario 1", { exact: true }) });
  await other.click();
  await expect(detail.locator(".bot-chat-bar")).toContainText(otherPane.paneLabel, { timeout: 20_000 });
  await expect(other).toHaveAttribute("aria-current", "true");
  await first.click();
  await expect(detail.locator(".bot-chat-bar")).toContainText(pane.paneLabel, { timeout: 20_000 });
  await expect(first).toHaveAttribute("aria-current", "true");
  await expect(other).not.toHaveAttribute("aria-current", "true");
  const pickerButton = sidebar.getByRole("button", { name: "Ir a un workspace" });
  await pickerButton.click();
  const pickerBox = (await sidebar.locator(".bot-picker").boundingBox())!;
  expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual((await detail.boundingBox())!.x);
  await pickerButton.click();
  const menu = page.getByRole("button", { name: "Opciones del chat" });
  await menu.click();
  const menuBox = (await detail.locator(".bot-popup").boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual((await detail.boundingBox())!.x);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.getByRole("button", { name: "Ver terminal" }).click();
  const terminal = detail.locator(".bot-terminal");
  await expect(terminal).toContainText("Ruta 120");
  const reader = terminal.locator("..");
  if (process.env.BOT_SCREENSHOTS && test.info().project.name === "desktop") {
    await reader.evaluate(el => { el.scrollTop = 0; });
    await screenshot(page, "terminal-1280");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await screenshot(page, "terminal-1920");
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  const screen = await terminal.locator("pre").first().elementHandle();
  const input = detail.locator('[data-slot="composer-box"] textarea').first();
  const url = page.url();
  await input.fill("Conservar este borrador");
  await first.click({ button: "right" });
  await expect(first).toBeChecked();
  const field = await input.elementHandle();

  const list = sidebar.locator(".bot-scroll");
  for (const scroller of [list, reader]) {
    await scroller.evaluate(el => { el.scrollTop = 65; });
    await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBe(65);
  }

  for (const [width, height] of [[768, 1024], [390, 844], [1280, 800], [1920, 1080]] as const) {
    await page.setViewportSize({ width, height });
    await expect(detail).toBeInViewport();
    await expect(input).toHaveValue("Conservar este borrador");
    await expect(first).toHaveAttribute("aria-checked", "true");
    await expect(page).toHaveURL(url);
    expect(await screen!.evaluate(el => el.isConnected)).toBe(true);
    expect(await field!.evaluate(el => el.isConnected)).toBe(true);
    for (const scroller of [list, reader]) expect(await scroller.evaluate(el => el.scrollTop)).toBe(65);

    const box = (await detail.boundingBox())!;
    if (width === 390) {
      await expect(sidebar).toHaveAttribute("inert", "");
      expect(box.x).toBe(0);
      expect(box.width).toBe(width);
      continue;
    }
    await expect(sidebar).not.toHaveAttribute("inert", "");
    const side = (await sidebar.boundingBox())!;
    expect(side.x).toBe(0);
    expect(side.width).toBeGreaterThanOrEqual(width === 768 ? 224 : 280);
    expect(side.width).toBeLessThanOrEqual(340);
    expect(box.x).toBeCloseTo(side.width, 0);
    expect(box.x + box.width).toBeCloseTo(width, 0);
    expect(box.height).toBeGreaterThan(height - 48);
    const controls = (await footer.boundingBox())!;
    expect(controls.x + controls.width).toBeLessThanOrEqual(side.width);
    for (const el of [terminal, detail.locator('[data-slot="composer-box"]')]) {
      const rect = (await el.boundingBox())!;
      expect(rect.width).toBeGreaterThan(box.width - 90);
      expect(rect.x).toBeGreaterThanOrEqual(box.x);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    }
  }
});
