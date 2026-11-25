import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixtureAgents, fixtureKiroChat, fixtureLaunchedTab, fixtureSnapshot, fixtureWalkyAgent } from "@/test/handlers";
import type { AgentView } from "@/lib/types";
import { installApiStub, installLauncherWorld, installPaneWorld, paneCapture, pinLocale } from "./fixtures/api";

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
  await page.screenshot({ path: join(dir, prefix + "-" + label + ".png"), animations: "disabled" });
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
  const snapshot = { ...fixtureSnapshot, agents: panes, shellPanes: [], workspaces: sections.map((label, i) => ({ ...fixtureSnapshot.workspaces[0]!, workspaceId: "w" + (i + 1), label })), ts: now };
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
  await expect(page.locator(".bot-user")).toHaveText("J");
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
  await expect(page.getByText(messages[3]!, { exact: true })).toBeVisible();
  await expect(page.getByText("Nuevos", { exact: true })).toBeVisible();
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
  const dialog = page.getByRole("dialog", { name: "Crear nuevo Bot" });
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
    await expect(page.locator(".bot-user")).toHaveText("J");
    expect(await page.locator(".bot-bar").evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(
      await notice.evaluate(el => el.getBoundingClientRect().top));
    await screenshot(page, pairedGate ? "sin-emparejar" : "sign-in");
    await page.getByRole("button", { name: "Crear nuevo", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("textbox").fill("Bitácora");
    await expect(sheet.getByRole("button", { name: "Crear", exact: true })).toBeDisabled();
    await expect(sheet.getByRole("link")).toBeVisible();
  });
}

test("the chat stack slides horizontally and keeps both footers and the list in place", async ({ page, browserName }) => {
  await installApiStub(page);
  const panes = Array.from({ length: 18 }, (_, i) => ({
    ...fixtureAgents[0]!, paneId: "w1:p" + (i + 1), paneLabel: "Kanban " + (i + 1),
  }));
  await page.route(url => url.pathname === "/api/snapshot", route => route.fulfill({
    json: { ...fixtureSnapshot, agents: panes, shellPanes: [] },
  }));
  if (browserName === "chromium") {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { bottom: 34 } });
  }
  await page.goto("/");
  const row = page.locator(".bot-row").first();
  await expect(row).toBeVisible();
  await page.locator(".bot-scroll").evaluate(el => { el.scrollTop = 60; });
  const shell = await page.locator("[data-bots]").elementHandle();
  const list = await page.locator(".bot-scroll").elementHandle();

  // WebKit on Linux has no home indicator. Exercise its native viewport first,
  // then the same CSS layout with the 34px clearance from the phone recording.
  const insets = browserName === "webkit" ? [null, 34] : [null];
  for (const inset of insets) {
    if (inset) await page.addStyleTag({ content: `[data-bots] { --bot-bottom: ${inset}px; }` });
    const start = await page.evaluateHandle(() => {
      const stack = document.querySelector<HTMLElement>(".bot-layout")!;
      const scroll = stack.querySelector(".bot-scroll")!;
      const panel = stack.querySelector("main")!;
      const search = stack.querySelector(".bot-search")!;
      const frames: { ms: number; open: boolean; x: number; search: number; composer: number | null; scroll: number }[] = [];
      const t0 = performance.now();
      let raf = 0;
      function sample() {
        const box = panel.querySelector('[data-slot="composer-box"]')?.getBoundingClientRect();
        frames.push({ ms: performance.now() - t0, open: stack.dataset.detail === "true",
          x: panel.getBoundingClientRect().left - stack.getBoundingClientRect().left,
          search: search.getBoundingClientRect().bottom, composer: box?.height ? box.bottom : null,
          scroll: scroll.scrollTop });
        raf = requestAnimationFrame(sample);
      }
      sample();
      return () => { cancelAnimationFrame(raf); return frames; };
    });
    const dir = process.env.BOT_SCREENSHOTS;
    // Capture actual paints while the independent rAF sampler measures every layout frame.
    const burst = async (direction: string, action: () => Promise<void>) => {
      if (!inset || !dir) { await action(); return; }
      const folder = join(dir, "brinco", direction);
      await mkdir(folder, { recursive: true });
      const shot = (i: number) => page.screenshot({ path: join(folder, String(i).padStart(2, "0") + ".png"), scale: "css" });
      await shot(0);
      await Promise.all([action(), (async () => {
        await page.waitForFunction(open => document.querySelector<HTMLElement>(".bot-layout")?.dataset.detail === String(open), direction === "ida");
        const begin = Date.now();
        for (let i = 1; Date.now() - begin < 540; i++) await shot(i);
      })()]);
    };
    await burst("ida", () => row.click());
    const field = page.locator('[data-slot="composer-box"] textarea').first();
    await expect(field).toBeInViewport();
    await page.waitForFunction(() => document.querySelector(".bot-detail")!.getBoundingClientRect().left === document.querySelector(".bot-layout")!.getBoundingClientRect().left);
    const composer = await field.elementHandle();
    if (inset) await burst("vuelta", async () => { await page.goBack(); });
    else await page.getByRole("button", { name: "Volver a los chats" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.waitForFunction(() => document.querySelector(".bot-detail")!.getBoundingClientRect().left >= document.querySelector(".bot-layout")!.getBoundingClientRect().right);
    // Sample the settled pop as well as the last moving frame.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const frames = await start.evaluate(finish => finish());
    const width = await page.locator(".bot-layout").evaluate(el => el.clientWidth);
    expect(width).toBe(390);
    expect(await shell?.evaluate(el => el.isConnected)).toBe(true);
    expect(await list?.evaluate(el => el.isConnected)).toBe(true);
    expect(await composer?.evaluate(el => el.isConnected)).toBe(true);
    for (const open of [true, false]) {
      const moving = frames.filter(f => f.open === open && f.x > 0 && f.x < width);
      expect(moving.length).toBeGreaterThan(0);
      expect(moving.every(f => f.composer !== null)).toBe(true);
    }
    expect(frames[0]!.scroll).toBeGreaterThan(0);
    expect(new Set(frames.map(f => f.scroll)).size).toBe(1);
    expect(new Set(frames.map(f => f.search)).size).toBe(1);
    const composerEdges = frames.flatMap(f => f.composer === null ? [] : [f.composer]);
    expect(Math.max(...composerEdges) - Math.min(...composerEdges)).toBeLessThan(0.51);
    if (inset || browserName === "chromium") expect(frames[0]!.search).toBeCloseTo(page.viewportSize()!.height - 34, 1);
    if (dir) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${test.info().project.name}-frames-${inset ?? "native"}.json`), JSON.stringify(frames, null, 2));
    }
  }
});

test("desktop paints the same list and chat as a 390px column", async ({ page }) => {
  await installApiStub(page);
  await page.goto("/");
  const row = page.locator(".bot-row").first();
  await expect(row).toBeVisible();
  const column = page.locator(".bot-layout");
  async function compare(view: string) {
    const boxes = column.locator(".bot-index header, .bot-featured, .bot-row, .bot-search, .bot-chat-bar, .bot-terminal, [data-slot=composer-box], [data-slot=composer-box] button");
    const geometry = () => boxes.evaluateAll(elements => elements.map(el => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x: x - el.closest(".bot-layout")!.getBoundingClientRect().left, y, width, height };
    }));
    const dir = process.env.BOT_SCREENSHOTS;
    const save = async (size: string) => {
      if (!dir) return;
      await mkdir(dir, { recursive: true });
      await column.screenshot({ path: join(dir, `${test.info().project.name}-${view}-columna-${size}.png`), scale: "css", animations: "disabled" });
    };
    await page.setViewportSize({ width: 390, height: 800 });
    const narrow = await geometry();
    await save("390");
    await page.setViewportSize({ width: 1280, height: 800 });
    const rect = await column.boundingBox();
    expect(rect?.width).toBe(390);
    expect(rect?.x).toBe(445);
    expect(await geometry()).toEqual(narrow);
    await save("1280");
  }
  await compare("lista");
  await row.click();
  await expect(page.locator('[data-slot="composer-box"]')).toBeInViewport();
  await page.waitForFunction(() => document.querySelector(".bot-detail")!.getBoundingClientRect().left === document.querySelector(".bot-layout")!.getBoundingClientRect().left);
  await page.mouse.move(0, 0);
  await compare("chat");
});
