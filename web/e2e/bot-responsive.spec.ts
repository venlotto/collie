import { expect, test, type Page, type Locator } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot } from "@/test/handlers";
import { installApiStub, installLauncherWorld, installPaneWorld, paneCapture, pinLocale } from "./fixtures/api";

const TITLE = "Auditoría de conversaciones y paneles con nombres extensos";

test.beforeEach(async ({ page }) => {
  // A context-level backstop also catches late WebKit polls after page routes are removed.
  // This makes the same suite safe against deployed assets: every API call stays in fixtures.
  await page.context().route("**/api/**", route => route.fulfill({ status: 503, body: "Unstubbed audit request" }));
  await pinLocale(page, "es");
  await installApiStub(page);
  // The same upload capability exercised by composer-media.test.tsx.
  await page.route("**/api/config", route => route.fulfill({ json: { push: false, vapidPublicKey: "", upload: {
    maxBytes: 1024, imageTypes: ["png"], textTypes: ["txt"], videoTypes: ["mp4", "mov", "webm"],
  } } }));
  await installLauncherWorld(page);
  const agent = { ...fixtureAgents[0]!, agent: "kiro", hasSession: true, status: "idle" as const,
    paneLabel: TITLE, workspaceLabel: "Workspace_con_un_nombre_muy_largo_sin_espacios_para_comprobar_el_ancho" };
  await installPaneWorld(page, { paneId: agent.paneId,
    snapshot: { ...fixtureSnapshot, agents: [agent], shellPanes: [], ts: Date.now(),
      workspaces: [{ ...fixtureSnapshot.workspaces[0]!, label: agent.workspaceLabel }],
      device: { enforced: true, authorized: true, device: "Auditoría" } },
    chat: { ...fixtureKiroChat, paneId: agent.paneId },
    screens: { idle: paneCapture("kiro--v3-idle-w120") }, start: "idle" });
  await page.goto("/");
});

async function capture(page: Page, label: string) {
  const dir = process.env.BOT_SCREENSHOTS;
  const geometry = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>(".bot-layout,.bot-sidebar,.bot-detail,.bot-window .bot-bar,.bot-desk-ctrls,.bot-window .bot-pill,.bot-popup:popover-open,.bot-sheet,[data-slot=composer-box]")]
      .filter(el => el.checkVisibility()).map(el => {
        const r = el.getBoundingClientRect();
        return { name: el.className, x: r.x, y: r.y, width: r.width, height: r.height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      });
    return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, boxes };
  });
  if (dir) {
    await mkdir(dir, { recursive: true });
    const name = test.info().project.name + "-" + label;
    await page.screenshot({ path: join(dir, name + ".png"), animations: "disabled", scale: "css" });
    await writeFile(join(dir, name + ".json"), JSON.stringify(geometry, null, 2));
  }
  expect.soft(geometry.documentWidth).toBeLessThanOrEqual(geometry.width);
}

async function fits(locator: Locator) {
  await expect(locator).toBeVisible();
  const viewport = locator.page().viewportSize()!;
  // WebKit can report transform:none before scheduling a sheet's first animation frame.
  // Wait for the actual resting bounds, rather than sampling the entrance halfway through.
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    return box && {
      left: box.x >= -1,
      top: box.y >= -1,
      right: box.x + box.width <= viewport.width + 1,
      bottom: box.y + box.height <= viewport.height + 1,
    };
  }).toEqual({ left: true, top: true, right: true, bottom: true });
}

test("list, chat, composer and menus fit the viewport", async ({ page, browserName }) => {
  // A phone's bottom inset must not leave a second band beneath the reply field.
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { bottom: 34 } });
  }
  await fits(page.getByRole("searchbox"));
  await capture(page, "lista");
  const group = page.getByRole("button", { name: /^Workspace_con/ });
  expect.soft(await group.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("button").filter({ hasText: TITLE }).first().click();
  const field = page.getByRole("textbox");
  await expect(field).toBeVisible();
  await capture(page, "chat");
  // The transparent dock reaches the edge while the glass input floats above the safe area.
  const composerBottom = await field.evaluate(el => el.closest('[data-slot="pane-bottom"]')!.getBoundingClientRect().bottom);
  expect(Math.abs(composerBottom - page.viewportSize()!.height)).toBeLessThanOrEqual(1);
  const fieldBottom = await field.evaluate(el => el.closest('[data-slot="composer-box"]')!.getBoundingClientRect().bottom);
  expect(composerBottom - fieldBottom).toBeGreaterThanOrEqual(12);
  expect(composerBottom - fieldBottom).toBeLessThanOrEqual(35);
  await expect(page.locator('[data-slot="pane-bottom"]')).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator(".bot-chat-bar")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await fits(field);
  await field.fill("Borrador de auditoría\nSegunda línea con texto largo para comprobar el ajuste a la pantalla\nTercera línea");
  await fits(page.getByRole("button", { name: "Enviar", exact: true }));
  await capture(page, "composer");
  const latest = page.getByRole("button", { name: "Desplazarse a lo más reciente", exact: true });
  await expect(latest).toBeVisible();
  const jumpBox = (await latest.boundingBox())!;
  const composerBox = (await field.locator("..").boundingBox())!;
  expect.soft(jumpBox.y + jumpBox.height).toBeLessThanOrEqual(composerBox.y);
  await page.getByRole("button", { name: "Opciones del chat" }).click();
  await fits(page.getByRole("radiogroup", { name: "Vista", exact: true }));
  await capture(page, "menu");
  await page.getByRole("radio", { name: "Terminal", exact: true }).click();
  await page.keyboard.press("Escape");
  await capture(page, "terminal");
});

test("create sheets keep every control reachable", async ({ page }) => {
  await page.getByRole("button", { name: "Crear nuevo", exact: true }).click({ button: "right" });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("form")).toHaveCSS("transform", "none");
  await capture(page, "crear");
  await fits(dialog.getByRole("textbox").first());
  const create = dialog.getByRole("button", { name: "Crear", exact: true });
  await create.scrollIntoViewIfNeeded();
  await fits(create);
  await capture(page, "crear-final");
  await dialog.getByRole("button", { name: "Existente", exact: true }).click();
  await fits(dialog.getByRole("combobox", { name: "Workspace existente" }));
  await capture(page, "crear-workspace");
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 440 });
  await create.scrollIntoViewIfNeeded();
  await fits(create);
  await capture(page, "crear-bajo");
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).scrollIntoViewIfNeeded();
  await fits(dialog.getByRole("button", { name: "Cerrar", exact: true }));
});


test("the hub respects the corrected app height", async ({ page }) => {
  await page.evaluate(() => document.documentElement.style.setProperty("--app-h", "420px"));
  await expect.poll(async () => (await page.getByRole("searchbox").boundingBox())!.y).toBeLessThan(420);
});

test("long titles leave window controls usable on the desk", async ({ page }) => {
  test.skip(page.viewportSize()!.width < 1280, "two desktop windows need room");
  const agents = fixtureAgents.slice(0, 2).map((a, i) => Object.assign({}, a, { hasSession: true, status: "idle" as const,
    paneLabel: `${TITLE} ${i}`, terminalId: `audit-${i}` }));
  for (const agent of agents) await installPaneWorld(page, { paneId: agent.paneId,
    snapshot: { ...fixtureSnapshot, agents, shellPanes: [], ts: Date.now() }, chat: fixtureKiroChat,
    screens: { idle: paneCapture("kiro--v3-idle-w120") }, start: "idle" });
  await page.reload();
  for (const agent of agents) {
    await page.getByRole("button").filter({ hasText: agent.paneLabel }).first().click();
    await expect(page.getByRole("main").getByText(agent.paneLabel, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Minimizar", exact: true })).toHaveCount(2);
  for (const region of await page.getByRole("region", { name: /Auditoría/ }).all()) {
    await expect.poll(() => region.evaluate(el => el.getAnimations().length)).toBe(0);
  }
  await capture(page, "paneles");
  for (const region of await page.getByRole("region", { name: /Auditoría/ }).all()) {
    const close = (await region.getByRole("button", { name: "Cerrar ventana" }).boundingBox())!;
    const title = (await region.getByText(/Auditoría/, { exact: false }).first().locator("..").boundingBox())!;
    expect.soft(close.x + close.width).toBeLessThanOrEqual(title.x);
    const menu = region.getByRole("button", { name: "Opciones del chat" });
    if (await menu.count()) await fits(menu);
  }
});


test("attachments, editing and a short viewport stay usable", async ({ page }) => {
  await page.getByRole("button").filter({ hasText: TITLE }).first().click();
  await page.getByRole("button", { name: "Adjuntar archivo", exact: true }).click();
  const attachments = page.getByRole("dialog", { name: "Adjuntar", exact: true });
  await fits(attachments);
  await expect(attachments.getByRole("button", { name: "Videos", exact: true })).toBeVisible();
  await capture(page, "adjuntos");
  await page.keyboard.press("Escape");
  await page.route(/\/api\/pane\/[^/]+\/upload(?:\?|$)/, route => route.fulfill({ json: { ok: true, path: "/uploads/nota.txt" } }));
  await page.getByTestId("attach-files").setInputFiles({ name: "nota.txt", mimeType: "text/plain", buffer: Buffer.from("Nota adjunta") });
  const chip = page.locator('[data-slot="composer-box"] > ul > li');
  await expect(chip).toBeVisible();
  await fits(chip);
  await capture(page, "adjunto-preview");
  const title = page.locator(".bot-chat-bar").getByRole("button", { name: TITLE });
  if (test.info().project.use.hasTouch) await title.tap();
  else await title.click();
  const dialog = page.getByRole("dialog", { name: "Editar bot", exact: true });
  await expect(dialog.locator("form")).toHaveCSS("transform", "none");
  await fits(dialog.getByRole("textbox", { name: "Nombre del bot" }));
  await capture(page, "editar");
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const field = page.getByRole("textbox");
  await field.fill("Borrador que se conserva al cambiar de tamaño");
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 440 });
  await fits(field);
  await fits(page.getByRole("button", { name: "Enviar", exact: true }));
  await expect(field).toHaveValue("Borrador que se conserva al cambiar de tamaño");
  await capture(page, "chat-bajo");
});

async function noOverlap(a: Locator, b: Locator) {
  const [x, y] = [(await a.boundingBox())!, (await b.boundingBox())!];
  return x.x + x.width <= y.x + 1 || y.x + y.width <= x.x + 1 || x.y + x.height <= y.y + 1 || y.y + y.height <= x.y + 1;
}

test("the unread chip keeps its own place above the search bar", async ({ page }) => {
  const now = Date.now();
  const spaces = ["Duck Race Rooms", "Plan sync BNC nexo", "Auditoría de pagos"].map((label, i) =>
    Object.assign({}, fixtureSnapshot.workspaces[0]!, { workspaceId: "u" + i, number: i + 1, label }));
  const agents = Array.from({ length: 21 }, (_, i) => Object.assign({}, fixtureAgents[0]!, {
    agent: "kiro", status: "idle" as const, hasSession: true, workspaceId: spaces[i % 3]!.workspaceId,
    workspaceLabel: spaces[i % 3]!.label, paneId: spaces[i % 3]!.workspaceId + ":p" + i, terminalId: "unread-" + i,
    paneLabel: (i === 20 ? "Plan sync pendiente " : "Duck Race Rooms ") + i,
    // Only the last row of the last section is unread, so it starts below the fold.
    lastActiveAt: now - (i + 1) * 60_000, lastSeenAt: i === 20 ? now - 3_600_000 : now,
  }));
  await installPaneWorld(page, { paneId: agents[0]!.paneId,
    snapshot: { ...fixtureSnapshot, agents, shellPanes: [], workspaces: spaces, ts: now,
      device: { enforced: true, authorized: true, device: "Auditoría" } },
    chat: { ...fixtureKiroChat, paneId: agents[0]!.paneId }, screens: { idle: paneCapture("kiro--v3-idle-w120") }, start: "idle" });
  await page.reload();
  const chip = page.getByRole("button", { name: /1 sin leer/ });
  const search = page.getByRole("searchbox").locator("..");
  await expect(chip).toBeVisible();
  await fits(chip);
  await capture(page, "no-leidos");
  expect.soft(await noOverlap(chip, search)).toBe(true);
  // No row paints under the chip: the list's visible edge stops above it.
  const covered = await page.evaluate(() => {
    const pill = [...document.querySelectorAll("button")].find(b => /sin leer/.test(b.textContent ?? ""))!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>(".bot-scroll .bot-row, .bot-scroll .bot-group")].filter(el => {
      const list = el.closest(".bot-scroll")!;
      const edge = list.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(list).getPropertyValue("--bot-foot-clip")) || 0);
      const r = el.getBoundingClientRect();
      const top = r.top, bottom = Math.min(r.bottom, list.hasAttribute("data-jump-below") ? edge : r.bottom);
      return bottom - top > 1 && bottom > pill.top + 1 && top < pill.bottom - 1 && r.right > pill.left && r.left < pill.right;
    }).map(el => el.textContent);
  });
  expect.soft(covered).toEqual([]);
  // The end of the list rests above the chip and the bar, never under them.
  const list = page.locator(".bot-scroll");
  await list.evaluate(el => el.scrollTo({ top: el.scrollHeight }));
  const last = page.getByRole("button").filter({ hasText: "Plan sync pendiente 20" });
  await expect.poll(async () => (await last.boundingBox())!.y + (await last.boundingBox())!.height)
    .toBeLessThanOrEqual((await search.boundingBox())!.y);
  await expect(chip).toHaveCount(0);
  await capture(page, "no-leidos-final");
});

test("a finished agent run keeps the composer and its actions whole", async ({ page }) => {
  await pinLocale(page, "en");
  const now = Date.now();
  const run = { id: "finished-run", status: "done" as const, start: now - 9 * 60_000, end: now, canResume: true, plan: true,
    name: "collie-responsive-audit", harness: "codexp" };
  const agent = { ...fixtureAgents[0]!, agent: "shell", kind: "shell" as const, status: "done" as const, hasSession: true,
    paneLabel: "collie-responsive-audit", workspaceLabel: "Noviembre", agentRun: run,
    surface: { revision: 0, turn: "unknown" as const, modal: "unknown" as const, composer: "unknown" as const, reason: "no-match" as const } };
  await installPaneWorld(page, { paneId: agent.paneId,
    snapshot: { ...fixtureSnapshot, agents: [], shellPanes: [agent], ts: now,
      workspaces: [{ ...fixtureSnapshot.workspaces[0]!, label: agent.workspaceLabel }],
      device: { enforced: true, authorized: true, device: "Auditoría" } },
    chat: { ...fixtureKiroChat, paneId: agent.paneId }, screens: { idle: "tail -F agent.log" }, start: "idle" });
  await page.route(url => url.pathname === "/api/pane/" + encodeURIComponent("agent-run:" + run.id) + "/chat",
    route => route.fulfill({ json: { ...fixtureKiroChat, paneId: "agent-run:" + run.id } }));
  await page.goto("/pane/" + encodeURIComponent(agent.paneId));
  const field = page.getByRole("textbox");
  const resume = page.getByRole("button", { name: "Continue with the agent", exact: true });
  const implement = page.getByRole("button", { name: "Implement", exact: true });
  const attach = page.getByRole("button", { name: "Attach file", exact: true });
  for (const control of [field, resume, implement, attach]) await fits(control);
  const whole = async () => {
    for (const [a, b] of [[field, resume], [field, attach], [resume, attach], [implement, field], [implement, resume]] as const)
      expect.soft(await noOverlap(a, b)).toBe(true);
    // The placeholder is never cut before the bot's name begins.
    const placeholder = await field.evaluate((el: HTMLTextAreaElement) => {
      const probe = document.createElement("span");
      const style = getComputedStyle(el);
      probe.style.font = style.font;
      probe.style.position = "absolute";
      probe.style.whiteSpace = "pre";
      probe.textContent = "Preguntar a ";
      document.body.append(probe);
      const need = probe.getBoundingClientRect().width;
      probe.remove();
      return { need, room: el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
    });
    expect.soft(placeholder.room).toBeGreaterThan(placeholder.need);
    // The label itself sits inside the button (its tap target's ::before reaches 4px past it on purpose).
    const label = await resume.evaluate(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const [text, box] = [range.getBoundingClientRect(), el.getBoundingClientRect()];
      return text.left >= box.left - 1 && text.right <= box.right + 1 && text.top >= box.top - 1 && text.bottom <= box.bottom + 1;
    });
    expect.soft(label).toBe(true);
  };
  await whole();
  await capture(page, "agente-terminado");
  await field.fill("Retoma el último ajuste con un borrador largo para comprobar el ancho del composer");
  await fits(resume);
  await expect(resume).toBeEnabled();
  await whole();
  await capture(page, "agente-terminado-borrador");
});


for (const entry of ["title", "menu"] as const) test(`moving the open bot from ${entry} follows its new workspace without leaving the chat`, async ({ page }) => {
  const source = { ...fixtureSnapshot.workspaces[0]!, workspaceId: "w1", label: "Origen" };
  const destination = { ...source, workspaceId: "w2", label: "Destino" };
  const original = { ...fixtureAgents[0]!, terminalId: "move-chat-terminal", agent: "kiro", hasSession: true,
    status: "idle" as const, paneLabel: TITLE, workspaceId: "w1", workspaceLabel: source.label };
  const moved = { ...original, paneId: "w2:p4", tabId: "w2:t1", workspaceId: "w2", workspaceLabel: destination.label };
  const deletedSpace = { ...source, workspaceId: "w-trash", label: "Workspace eliminado" };
  const deletedBot = { ...original, paneId: "w-trash:p1", terminalId: "deleted-terminal", workspaceId: deletedSpace.workspaceId,
    trash: { originalWorkspaceId: deletedSpace.workspaceId, workspaceLabel: deletedSpace.label, trashedAt: Date.now() } };
  const snapshot = { ...fixtureSnapshot, agents: [original, deletedBot], shellPanes: [], workspaces: [source, destination, deletedSpace], ts: Date.now(),
    device: { enforced: true, authorized: true, device: "Move test" } };
  let current = snapshot;
  for (const agent of [original, moved]) {
    await installPaneWorld(page, { paneId: agent.paneId, snapshot,
      chat: { ...fixtureKiroChat, paneId: agent.paneId },
      screens: { idle: paneCapture("kiro--v3-idle-w120") }, start: "idle" });
  }
  await page.route("**/api/snapshot*", route => route.fulfill({ json: current }));
  await page.route("**/api/bot-action*", route => {
    expect(route.request().postDataJSON()).toMatchObject({ action: "move", terminalId: original.terminalId, workspaceId: "w2" });
    current = { ...snapshot, agents: [moved, deletedBot], ts: Date.now() };
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await page.getByRole("button").filter({ hasText: TITLE }).first().click();
  await page.getByRole("textbox").fill("Mi mensaje pendiente");
  const returnedToList: string[] = [];
  page.on("framenavigated", frame => { if (frame === page.mainFrame() && new URL(frame.url()).pathname === "/") returnedToList.push(frame.url()); });
  if (entry === "title") {
    await page.locator(".bot-chat-bar").getByRole("button", { name: TITLE }).click();
    const dialog = page.getByRole("dialog", { name: "Editar bot", exact: true });
    const workspaces = dialog.getByRole("combobox", { name: "Workspace existente" });
    await expect(workspaces.getByRole("option")).toHaveText(["Origen", "Destino"]);
    await expect(workspaces.getByRole("option", { name: deletedSpace.label })).toHaveCount(0);
    await workspaces.selectOption("w2");
    await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "Opciones del chat" }).click();
    await page.getByRole("button", { name: "Cambiar workspace", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Cambiar workspace" });
    await expect(dialog.getByRole("button", { name: deletedSpace.label })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Destino", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/pane\/w2%3Ap4/);
  await expect(page.locator(".bot-chat-bar")).toContainText(TITLE);
  await expect(page.getByRole("textbox")).toHaveValue("Mi mensaje pendiente");
  await expect(page.locator(".bot-layout")).toHaveAttribute("data-detail", "true");
  expect(returnedToList).toEqual([]);
});


test.describe("wide-screen reply layout", () => {
  // Chromium covers a desktop mouse. Keep WebKit's supported phone context (see playwright.config)
  // and resize it to exercise the same wide layout without its desktop-mode navigation hang.
  test.use({
    hasTouch: async ({ browserName }, use) => use(browserName === "webkit"),
    isMobile: async ({ browserName }, use) => use(browserName === "webkit"),
  });

test("desktop reply floats over the chat and terminal", async ({ page }) => {
  await page.setViewportSize({ width: 1630, height: 900 });
  await page.getByRole("button").filter({ hasText: TITLE }).first().click();
  const field = page.getByRole("textbox");
  for (const view of ["chat", "terminal"]) {
    if (view === "terminal") {
      await page.getByRole("button", { name: "Opciones del chat" }).click();
      await page.getByRole("radio", { name: "Terminal", exact: true }).click();
      await page.keyboard.press("Escape");
    }
    await field.fill("Borrador de escritorio");
    await capture(page, "desktop-" + view);
    const bottom = await field.evaluate(el => el.closest('[data-slot="composer-box"]')!.getBoundingClientRect().bottom);
    expect(page.viewportSize()!.height - bottom).toBeCloseTo(12, 0);
  }
});
});
