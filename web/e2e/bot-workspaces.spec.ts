import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixtureAgents, fixtureKiroChat, fixtureLaunchedTab, fixtureLaunchersWithAgents, fixtureSnapshot, fixtureWalkyAgent, paneTextWithDraft } from "@/test/handlers";
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

async function sheetAnimationMidpoint(page: Page, name: "bot-up" | "bot-down") {
  const probe = await page.evaluateHandle(animationName => {
    // SAFETY: the observer replaces null with the measured bottom before it disconnects.
    const sample = { value: null as number | null };
    const observer = new MutationObserver(() => {
      const sheet = document.querySelector(".bot-sheet");
      const animation = sheet?.getAnimations().find(candidate =>
        candidate instanceof CSSAnimation && candidate.animationName === animationName);
      if (!sheet || !animation?.effect) return;
      animation.pause();
      animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
      sample.value = sheet.getBoundingClientRect().bottom;
      observer.disconnect();
      animation.play();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["open", "data-leaving"] });
    return sample;
  }, name);
  return {
    finish: async () => {
      await expect.poll(() => probe.evaluate(sample => sample.value)).not.toBeNull();
      const bottom = await probe.evaluate(sample => sample.value!);
      await probe.dispose();
      return bottom;
    },
  };
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
      transform: getComputedStyle(form).transform, surface: getComputedStyle(form).backgroundColor,
      filter: getComputedStyle(form).getPropertyValue("backdrop-filter") || getComputedStyle(form).getPropertyValue("-webkit-backdrop-filter") };
  });
  expect(geometry.gap).toBeGreaterThan(0);
  expect(geometry.faceSize).toBeGreaterThan(0);
  expect(Math.abs(geometry.centerOffset)).toBeLessThan(1);
  expect(geometry.transform).toBe("none");
  expect(geometry.surface).toBe("rgba(27, 27, 31, 0.6)");
  expect(geometry.filter).toContain("blur(24px)");
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
  const agents = [
    { id: "codexp", harness: "codex", efforts: ["low", "medium", "high", "xhigh"] },
    { id: "claudep", harness: "claude", efforts: ["low", "medium", "high", "xhigh", "max"] },
    { id: "kimi", harness: "claude", efforts: ["low", "medium", "high"] },
  ];
  let holdCatalog: Promise<void> = Promise.resolve();
  await page.route(url => url.pathname === "/api/launchers", async route => {
    await holdCatalog;
    await route.fulfill({ json: { ...fixtureLaunchersWithAgents,
      botCreate: { agents, last: launch.launches.at(-1)?.body.botCreate ?? null } } });
  });
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
  await page.route("**/api/bot-featured", route => route.fulfill({ json: { userId: "local", featured: {
    row: ["", "", panes[0]!.paneId].join("\u0000"), space: panes[0]!.workspaceLabel, at: now,
  } } }));
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
  const chrome = await page.locator(".bot-index").evaluate(index => {
    const bar = index.querySelector(".bot-bar")!.getBoundingClientRect();
    const list = index.querySelector(".bot-scroll")!.getBoundingClientRect();
    const styles = getComputedStyle(index.querySelector(".bot-row")!);
    return { overlap: bar.bottom - list.top, filter: styles.getPropertyValue("backdrop-filter") || styles.getPropertyValue("-webkit-backdrop-filter") };
  });
  expect(chrome.overlap).toBeGreaterThanOrEqual(57);
  expect(chrome.filter).toBe("none");
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
  const underBars = await page.locator(".bot-detail").evaluate(panelDetail => {
    const reader = panelDetail.querySelector('[data-slot="session-stream"]')!.getBoundingClientRect();
    const header = panelDetail.querySelector(".bot-chat-bar")!.getBoundingClientRect();
    const box = panelDetail.querySelector('[data-slot="composer-box"]')!.getBoundingClientRect();
    return { top: header.bottom - reader.top, bottom: reader.bottom - box.top };
  });
  expect(underBars.top).toBeGreaterThan(0);
  expect(underBars.bottom).toBeGreaterThan(0);
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
  await page.getByRole("radio", { name: "Terminal", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".bot-terminal")).toBeVisible();
  await page.getByRole("button", { name: "Volver a los chats" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Crear nuevo", exact: true }).click();
  const dialog = await settledSheet(page);
  await expect(dialog.getByRole("button", { name: "Crear", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "codexp", pressed: true })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "high", exact: true, pressed: true })).toBeEnabled();
  await screenshot(page, "crear");
  await dialog.getByRole("button", { name: "claudep" }).click();
  await dialog.getByRole("button", { name: "medium" }).click();
  await dialog.getByRole("button", { name: "Forma 4", exact: true }).click();
  await dialog.getByRole("button", { name: "Verde", exact: true }).click();
  await dialog.getByRole("textbox").fill("Bitácora");
  const displayWrites: { row: string; view: string }[] = [];
  await page.route("**/api/bot-display", async route => {
    if (route.request().method() === "PUT") displayWrites.push(route.request().postDataJSON());
    await route.fallback();
  });
  await expect(dialog.getByRole("button", { name: "Sin asignar", pressed: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Existente", exact: true }).click();
  const existing = dialog.getByRole("combobox", { name: "Workspace existente" });
  await expect(existing.locator("option")).toHaveText(sections);
  await existing.selectOption({ label: "Viajes" });
  await screenshot(page, "crear-workspace-existente");
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await expect.poll(() => launch.launches.length).toBe(1);
  await expect(page.locator(".bot-chat-bar strong")).toHaveText("Bitácora");
  expect(launch.launches[0]?.body).toMatchObject({ spaceId: "w3" });
  expect(launch.launches[0]?.body).not.toHaveProperty("paneId");
  expect(launch.launches[0]?.body).not.toHaveProperty("spaceLabel");
  await expect.poll(() => displayWrites).toContainEqual({ row: ["", "", fixtureLaunchedTab.pane.paneId].join("\u0000"), view: "chat" });
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(fixtureLaunchedTab.pane.paneId)));
  expect(launch.launches[0]?.body).toMatchObject({ harness: "claude", botCreate: { agent: "claudep", effort: "medium" } });
  const cacheKey = "collie:bot-create:v1:";
  expect(await page.evaluate(key => localStorage.getItem(key), cacheKey)).toBe(JSON.stringify({ agent: "claudep", effort: "medium" }));
  // Simulate another device's stale cache. Hold GET so the first paint is observable.
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ agent: "kimi", effort: "low" })), cacheKey);
  await page.goto("/");
  let release!: () => void;
  holdCatalog = new Promise(resolve => { release = resolve; });
  await page.getByRole("button", { name: "Crear nuevo", exact: true }).click();
  await expect(page.getByRole("button", { name: "kimi", pressed: true })).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: "claudep", pressed: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "medium", pressed: true })).toBeEnabled();
  await screenshot(page, "crear-recordado");

});

async function openGlassThread(page: Page) {
  const pane = { ...fixtureAgents[0]!, paneLabel: "Vidrio", agent: "kiro", hasSession: true };
  const now = Date.now();
  const upserts = Array.from({ length: 30 }, (_, i) => ({
    uuid: "glass-" + i,
    ts: new Date(now - (30 - i) * 60_000).toISOString(),
    role: i % 2 === 0 ? "user" as const : "assistant" as const,
    parts: [{ kind: "text" as const, text: `Mensaje ${i + 1}: una burbuja real debe pasar bajo el vidrio.` }],
    seq: i + 1,
  }));
  await installApiStub(page);
  if (fixtureKiroChat.page !== "live") throw new Error("Expected a live chat fixture");
  await installPaneWorld(page, {
    paneId: pane.paneId,
    snapshot: { ...fixtureSnapshot, agents: [pane], shellPanes: [], ts: now },
    chat: { ...fixtureKiroChat, oldest: 1, head: 30, upserts },
    start: "idle", screens: { idle: paneCapture("kiro--v3-idle-w120") },
  });
  await page.goto("/");
  await page.locator(".bot-row").filter({ hasText: pane.paneLabel }).click();
  await expect(page.locator(".bot-detail .bot-turn")).toHaveCount(30, { timeout: 20_000 });
}

async function glassPixel(page: Page, label: string, point: { x: number; y: number }) {
  const png = await page.screenshot({ scale: "css", animations: "disabled" });
  if (process.env.BOT_SCREENSHOTS) {
    const dir = process.env.BOT_SCREENSHOTS;
    const project = test.info().project.name;
    const prefix = project.includes("desktop") ? "escritorio" : "iphone-webkit";
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${prefix}-${label}.png`), png);
  }
  const pixel = await page.evaluate(async ({ encoded, at }) => {
    const image = new Image();
    image.src = "data:image/png;base64," + encoded;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(Math.round(at.x), Math.round(at.y), 1, 1).data);
  }, { encoded: png.toString("base64"), at: point });
  if (process.env.BOT_SCREENSHOTS) {
    await writeFile(join(process.env.BOT_SCREENSHOTS, `${test.info().project.name}-${label}.json`), JSON.stringify({ point, pixel }));
  }
  return pixel;
}

function expectGreenThroughGlass(pixel: number[]) {
  // Pure green behind the material becomes a darker green, never black or an
  // unfiltered bright green. This reads the rendered result, not a CSS claim.
  expect(pixel[0]).toBeLessThan(100);
  expect(pixel[1]).toBeGreaterThan(60);
  expect(pixel[1]).toBeLessThan(225);
  expect(pixel[2]).toBeLessThan(100);
}

test("las filas se ven atenuadas bajo el vidrio de la lista", async ({ page }) => {
  await installApiStub(page);
  const agents = Array.from({ length: 20 }, (_, i) => ({
    ...fixtureAgents[0]!, paneId: "w1:p" + i, paneLabel: "Conversación " + i,
  }));
  await page.route(url => url.pathname === "/api/snapshot", route => route.fulfill({
    json: { ...fixtureSnapshot, agents, shellPanes: [] },
  }));
  await page.goto("/");
  const rows = page.locator(".bot-row");
  await expect(rows).toHaveCount(agents.length);
  const probe = rows.nth(5);
  await probe.evaluate(el => {
    el.style.background = "#00ff00";
    el.style.color = "transparent";
    el.style.minHeight = "112px";
  });
  const header = page.locator(".bot-list-surface > .bot-bar");
  const search = page.locator(".bot-search");

  await probe.evaluate(el => {
    const list = el.closest(".bot-scroll")!;
    list.scrollTop += el.getBoundingClientRect().top - document.querySelector(".bot-list-surface > .bot-bar")!.getBoundingClientRect().top + 12;
  });
  let point = await header.evaluate((bar, row) => ({
    x: row.left + row.width / 2,
    y: bar.getBoundingClientRect().bottom - 4,
  }), await probe.evaluate(el => {
    const { left, width } = el.getBoundingClientRect();
    return { left, width };
  }));
  expectGreenThroughGlass(await glassPixel(page, "lista-vidrio-arriba", point));

  const bottomProbe = rows.nth(15);
  await bottomProbe.evaluate(el => {
    el.style.background = "#00ff00";
    el.style.color = "transparent";
    el.style.minHeight = "112px";
  });
  await bottomProbe.evaluate(el => {
    const list = el.closest(".bot-scroll")!;
    const bottom = document.querySelector(".bot-search")!.getBoundingClientRect().top;
    list.scrollTop += el.getBoundingClientRect().top - bottom + 40;
  });
  point = await search.evaluate(bar => ({
    x: bar.getBoundingClientRect().right - 16,
    y: bar.getBoundingClientRect().top + bar.getBoundingClientRect().height / 2,
  }));
  expectGreenThroughGlass(await glassPixel(page, "lista-vidrio-abajo", point));

  for (const surface of [header, search]) {
    const filters = await surface.evaluate(el => {
      const style = getComputedStyle(el);
      return [style.getPropertyValue("backdrop-filter"), style.getPropertyValue("-webkit-backdrop-filter")];
    });
    expect(filters[0]).toContain("blur(24px)");
    expect(filters[1] || filters[0]).toContain("blur(24px)");
  }
});

test("las burbujas se ven atenuadas bajo el vidrio de ambas barras", async ({ page }) => {
  await openGlassThread(page);
  await expect.poll(() => page.locator(".bot-detail").evaluate(el => getComputedStyle(el).transform)).toBe("none");
  const probe = page.locator(".bot-detail .bot-turn").nth(7);
  await probe.evaluate(el => {
    el.style.background = "#00ff00";
    el.style.color = "transparent";
    el.style.minHeight = "112px";
  });
  const header = page.locator(".bot-chat-bar");
  const footer = page.locator('[data-slot="pane-bottom"]');

  await probe.evaluate(el => {
    const stream = el.closest('[data-slot="session-stream"]')!;
    stream.scrollTop += el.getBoundingClientRect().top - document.querySelector(".bot-chat-bar")!.getBoundingClientRect().top + 12;
  });
  await expect.poll(() => probe.evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(0);
  let point = await header.evaluate((bar, bubble) => ({
    x: bubble.left + bubble.width / 2,
    y: bar.getBoundingClientRect().bottom - 4,
  }), await probe.evaluate(el => {
    const { left, width } = el.getBoundingClientRect();
    return { left, width };
  }));
  expectGreenThroughGlass(await glassPixel(page, "vidrio-arriba", point));

  const bottomProbe = page.locator(".bot-detail .bot-turn").nth(19);
  await bottomProbe.evaluate(el => {
    el.style.background = "#00ff00";
    el.style.color = "transparent";
    el.style.minHeight = "112px";
  });
  await bottomProbe.evaluate(el => {
    const stream = el.closest('[data-slot="session-stream"]')!;
    const bottom = document.querySelector('[data-slot="pane-bottom"]')!.getBoundingClientRect().top;
    stream.scrollTop += el.getBoundingClientRect().top - bottom + 40;
  });
  await expect.poll(() => bottomProbe.evaluate(el => el.getBoundingClientRect().bottom)).toBeGreaterThan(
    await footer.evaluate(el => el.getBoundingClientRect().top),
  );
  point = await footer.evaluate((bar, bubble) => ({
    x: bubble.left + 4,
    y: bar.getBoundingClientRect().top + 24,
  }), await bottomProbe.evaluate(el => ({ left: el.getBoundingClientRect().left })));
  expectGreenThroughGlass(await glassPixel(page, "vidrio-abajo", point));

  for (const surface of [header, footer]) {
    const css = await surface.evaluate(el => {
      const style = getComputedStyle(el);
      return {
        background: style.backgroundColor,
        standard: style.getPropertyValue("backdrop-filter"),
        webkit: style.getPropertyValue("-webkit-backdrop-filter"),
      };
    });
    expect(css.standard).toContain("blur(24px)");
    // Chromium does not expose the prefixed alias through computed style.
    expect(css.webkit || css.standard).toContain("blur(24px)");
    expect(Number(css.background.match(/[\d.]+\)$/)?.[0].slice(0, -1))).toBeGreaterThanOrEqual(0.55);
    expect(Number(css.background.match(/[\d.]+\)$/)?.[0].slice(0, -1))).toBeLessThanOrEqual(0.7);
  }
});

test("create sheet fills the phone, slides both ways and stays centered on desktop", async ({ page }, info) => {
  await installApiStub(page);
  await installLauncherWorld(page);
  await page.route(url => url.pathname === "/api/launchers", route => route.fulfill({
    json: { ...fixtureLaunchersWithAgents, botCreate: { agents: [
      { id: "codexp", harness: "codex", efforts: ["low", "medium", "high", "xhigh"] },
      { id: "claudep", harness: "claude", efforts: ["low", "medium", "high", "xhigh", "max"] },
      { id: "kimi", harness: "claude", efforts: ["low", "medium", "high"] },
    ], last: null } },
  }));
  await page.goto("/");
  const phone = info.project.name.includes("phone");
  const opening = phone ? await sheetAnimationMidpoint(page, "bot-up") : null;
  await page.getByRole("button", { name: "Crear nuevo", exact: true }).click();
  const dialog = await settledSheet(page);
  const sheet = dialog.locator(".bot-sheet");
  const box = (await sheet.boundingBox())!;
  const viewport = page.viewportSize()!;
  if (phone) {
    expect(box.x).toBe(0);
    expect(box.width).toBe(viewport.width);
    expect(box.y + box.height).toBeCloseTo(viewport.height, 1);
    await expect(sheet).toHaveCSS("border-top-left-radius", "30px");
    await expect(sheet).toHaveCSS("border-top-right-radius", "30px");
    await expect(sheet).toHaveCSS("border-bottom-left-radius", "0px");
    await expect(sheet).toHaveCSS("border-bottom-right-radius", "0px");
    expect(await opening!.finish()).toBeGreaterThan(viewport.height);
    for (const name of ["codexp", "high"]) {
      expect((await dialog.getByRole("button", { name, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  } else {
    expect(box.width).toBe(440);
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(1);
    await expect(sheet).toHaveCSS("border-bottom-left-radius", "32px");
    await expect(sheet).toHaveCSS("border-bottom-right-radius", "32px");
  }
  await screenshot(page, "crear-geometria");
  if (!phone) return;
  for (const method of ["X", "backdrop", "Escape"] as const) {
    const closing = await sheetAnimationMidpoint(page, "bot-down");
    if (method === "X") await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    else if (method === "backdrop") await dialog.locator(".bot-backdrop").click({ position: { x: 8, y: 8 } });
    else await page.keyboard.press("Escape");
    expect(await closing.finish()).toBeGreaterThan(viewport.height);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if (method !== "Escape") {
      await page.getByRole("button", { name: "Crear nuevo", exact: true }).click();
      await settledSheet(page);
    }
  }
});

test("a host without bot profiles keeps the remembered selector visible and launches legacy", async ({ page }) => {
  await installApiStub(page);
  const launch = await installLauncherWorld(page);
  await page.addInitScript(() => localStorage.setItem("collie:bot-create:v1:", JSON.stringify({ agent: "kimi", effort: "low" })));
  await page.goto("/");
  await page.getByRole("button", { name: "Crear nuevo", exact: true }).click();
  const dialog = await settledSheet(page);
  for (const id of ["codexp", "claudep", "kimi"]) {
    await expect(dialog.getByRole("button", { name: id, exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: id, exact: true })).toBeDisabled();
  }
  await expect(dialog.getByRole("button", { name: "kimi", pressed: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "low", pressed: true })).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveText("Este equipo no ofrece elegir agente.");
  await screenshot(page, "crear-sin-perfiles");
  await dialog.getByRole("textbox").fill("Bot compatible");
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await expect.poll(() => launch.launches.length).toBe(1);
  expect(launch.launches[0]?.body.harness).toBe("claude");
  expect(launch.launches[0]?.body).not.toHaveProperty("botCreate");
  // Nothing picked: the bot goes to a new Sin asignar workspace, since this host has none yet.
  expect(launch.launches[0]?.body).toMatchObject({ spaceLabel: "Sin asignar" });
});

test("a new bot goes into Sin asignar when it exists, or into a new workspace it names", async ({ page }) => {
  const workspaces = [{ ...fixtureSnapshot.workspaces[0]!, workspaceId: "w7", label: "Sin asignar" }, ...fixtureSnapshot.workspaces];
  await installApiStub(page);
  await page.route(url => url.pathname === "/api/snapshot", route => route.fulfill({ json: { ...fixtureSnapshot, workspaces } }));
  const launch = await installLauncherWorld(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Crear nuevo", exact: true }).click();
  let dialog = await settledSheet(page);
  await dialog.getByRole("textbox").fill("Sin lugar");
  await dialog.getByRole("button", { name: "Crear", exact: true }).click();
  await expect.poll(() => launch.launches.length).toBe(1);
  expect(launch.launches[0]?.body).toMatchObject({ spaceId: "w7" });

  await page.goto("/");
  await page.getByRole("button", { name: "Crear nuevo", exact: true }).click();
  dialog = await settledSheet(page);
  await dialog.getByRole("textbox", { name: "Nombre del bot" }).fill("Con lugar");
  await dialog.getByRole("button", { name: "Nuevo", exact: true }).click();
  const create = dialog.getByRole("button", { name: "Crear", exact: true });
  await expect(create).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Nombre del workspace nuevo" }).fill("Proyecto X");
  await screenshot(page, "crear-workspace-nuevo");
  await create.click();
  await expect.poll(() => launch.launches.length).toBe(2);
  expect(launch.launches[1]?.body).toMatchObject({ spaceLabel: "Proyecto X" });
  expect(launch.launches[1]?.body).not.toHaveProperty("spaceId");
});

test("reducir transparencia conserva barras opacas sin desenfoque", async ({ page, browserName }) => {
  if (browserName === "chromium") {
    const client = await page.context().newCDPSession(page);
    await client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  } else {
    // Playwright WebKit has no OS transparency switch. Activate the shipped media block.
    await page.route(/\.css$/, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replaceAll(/\(prefers-reduced-transparency:\s*reduce\)/g, "(min-width:0px)") });
    });
  }
  await installApiStub(page);
  await page.goto("/");
  const search = page.locator(".bot-search");
  await expect(search).toHaveCSS("background-color", "rgb(27, 27, 31)");
  expect(await search.evaluate(el => {
    const css = getComputedStyle(el);
    return css.getPropertyValue("backdrop-filter") || css.getPropertyValue("-webkit-backdrop-filter");
  })).toBe("none");
  await openGlassThread(page);
  for (const surface of [page.locator(".bot-chat-bar"), page.locator('[data-slot="pane-bottom"]')]) {
    await expect(surface).toHaveCSS("background-color", "rgb(27, 27, 31)");
    const filters = await surface.evaluate(el => {
      const css = getComputedStyle(el);
      return [css.getPropertyValue("backdrop-filter"), css.getPropertyValue("-webkit-backdrop-filter")];
    });
    expect(filters.map(filter => filter || "none")).toEqual(["none", "none"]);
  }
  await screenshot(page, "transparencia-reducida");
});

test("scroll de una lista larga bajo el vidrio", async ({ page }) => {
  await installApiStub(page);
  const agents = Array.from({ length: 80 }, (_, i) => ({
    ...fixtureAgents[0]!, paneId: "w1:p" + i, paneLabel: "Conversación " + i,
  }));
  await page.route(url => url.pathname === "/api/snapshot", route => route.fulfill({
    json: { ...fixtureSnapshot, agents, shellPanes: [] },
  }));
  await page.goto("/");
  const list = page.locator(".bot-scroll");
  await expect(list.locator(".bot-row")).toHaveCount(agents.length);
  const result = await list.evaluate(el => new Promise<{ elapsed: number; frames: number; intervals: number[]; distance: number }>(resolve => {
    const intervals: number[] = [];
    requestAnimationFrame(start => {
      let previous = start;
      function frame(now: number) {
        const elapsed = now - start;
        intervals.push(now - previous);
        previous = now;
        el.scrollTop = elapsed;
        if (elapsed < 1500) requestAnimationFrame(frame);
        else resolve({ elapsed, frames: intervals.length, intervals, distance: el.scrollTop });
      }
      requestAnimationFrame(frame);
    });
  }));
  expect(result.distance).toBeGreaterThan(1000);
  if (process.env.BOT_SCREENSHOTS) {
    await mkdir(process.env.BOT_SCREENSHOTS, { recursive: true });
    await writeFile(join(process.env.BOT_SCREENSHOTS, test.info().project.name + "-scroll.json"), JSON.stringify(result));
  }
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
    await page.route("**/api/bot-featured", route => route.fulfill({ json: { userId: "local", featured: {
      row: ["", "", pane.paneId].join("\u0000"), space: pane.workspaceLabel, at: 1,
    } } }));
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
      const frames: { ms: number; source: "raf" | "midpoint"; open: boolean; x: number; sheet: string; scale: number; searchTop: number; search: number; composerTop: number | null; composer: number | null; scroll: number }[] = [];
      const t0 = performance.now();
      let raf = 0;
      function record(source: "raf" | "midpoint") {
        const box = panel.querySelector('[data-slot="composer-box"]')?.getBoundingClientRect();
        const rect = search.getBoundingClientRect();
        const dialog = stack.querySelector<HTMLElement>("dialog[open]");
        frames.push({ ms: performance.now() - t0, source, open: stack.dataset.detail === "true",
          x: panel.getBoundingClientRect().left - stack.getBoundingClientRect().left,
          sheet: dialog ? dialog.dataset.leaving === "true" ? "closing" : "open" : "closed",
          scale: surface.getBoundingClientRect().width / stack.clientWidth,
          searchTop: rect.top, search: rect.bottom, composerTop: box?.height ? box.top : null, composer: box?.height ? box.bottom : null,
          scroll: scroll.scrollTop });
      }
      // The compositor can finish a transform between two main-thread rAF callbacks.
      // Sample the actual CSS transition at its midpoint as well as recording live frames.
      const observer = new MutationObserver(changes => {
        const target = changes.some(change => change.attributeName === "data-detail") ? panel : surface;
        const transition = target.getAnimations().find(a => a instanceof CSSTransition && a.transitionProperty === "transform");
        const duration = Number(transition?.effect?.getTiming().duration);
        if (!transition || !(duration > 0)) return;
        const time = transition.currentTime;
        transition.currentTime = duration / 2;
        record("midpoint");
        transition.currentTime = time ?? 0;
      });
      observer.observe(stack, { subtree: true, attributes: true, attributeFilter: ["data-detail", "data-leaving", "open"] });
      function sample() {
        record("raf");
        raf = requestAnimationFrame(sample);
      }
      sample();
      return () => { observer.disconnect(); cancelAnimationFrame(raf); return frames; };
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
  // Back closes that chat; a second chat opened while one is showing would join it on the desk.
  await page.getByRole("button", { name: "Volver a los chats" }).click();
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
  await page.getByRole("radio", { name: "Terminal", exact: true }).click();
  await page.keyboard.press("Escape");
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

  // The scroll event changes the terminal from following its tail to reading history.
  await expect(reader.locator("..").getByRole("button", { name: "Desplazarse a lo más reciente" })).toBeVisible();

  for (const [width, height] of [[768, 1024], [390, 844], [1280, 800], [1920, 1080]] as const) {
    await page.setViewportSize({ width, height });
    await expect(detail).toBeInViewport();
    await expect(input).toHaveValue("Conservar este borrador");
    await expect(first).toHaveAttribute("aria-checked", "true");
    await expect(page).toHaveURL(url);
    expect(await screen!.evaluate(el => el.isConnected)).toBe(true);
    expect(await field!.evaluate(el => el.isConnected)).toBe(true);
    expect(await list.evaluate(el => el.scrollTop), `sidebar at ${width}px`).toBe(65);
    expect(await reader.evaluate(el => el.scrollTop), `terminal at ${width}px`).toBe(65);

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
    const terminalBox = (await terminal.boundingBox())!;
    const scrollbar = await reader.evaluate(el => el.getBoundingClientRect().width - el.clientWidth);
    expect(terminalBox.x).toBeCloseTo(box.x, 0);
    expect(terminalBox.width + scrollbar).toBeCloseTo(box.width, 0);
    const composer = (await detail.locator('[data-slot="composer-box"]').boundingBox())!;
    expect(composer.width).toBeGreaterThan(box.width - 90);
    expect(composer.x).toBeGreaterThanOrEqual(box.x);
    expect(composer.x + composer.width).toBeLessThanOrEqual(width);
  }
});
