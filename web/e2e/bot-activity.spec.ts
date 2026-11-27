import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { AgentView } from "@/lib/types";
import { fixtureAgents, fixtureKiroChat, fixtureShellPanes, fixtureSnapshot } from "@/test/handlers";
import { installApiStub, installPaneWorld, paneCapture, pinLocale } from "./fixtures/api";

type SnapshotRun = NonNullable<AgentView["agentRun"]>;

async function openActivityFixture(page: Page) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const now = Date.now();
  const workspace = { ...fixtureSnapshot.workspaces[0]!, label: "Equipo de diseño" };
  const portraits = [
    { paneLabel: "Orquestador", status: "working", hasSession: true },
    { paneLabel: "Diseño", status: "idle", hint: "Ya compartí las dos propuestas." },
    { paneLabel: "Revisión", status: "blocked" },
    { paneLabel: "Importación", status: "blocked", blockedBy: "error" },
    { paneLabel: "Bitácora", status: "done" },
  ] satisfies Partial<AgentView>[];
  const agents: AgentView[] = portraits.map((portrait, i) => Object.assign({}, fixtureAgents[0]!, portrait, {
    agent: "kiro", workspaceLabel: workspace.label,
    paneId: workspace.workspaceId + ":p" + (i + 1), terminalId: "fixture-activity-" + i,
    lastActiveAt: now - (i + 1) * 60_000, lastSeenAt: now - 3_600_000,
  }));
  const agentRun: SnapshotRun = {
    id: "fixture-export", status: "running", start: now - 60_000, end: null,
  };
  const run = {
    ...fixtureShellPanes[0]!, workspaceId: workspace.workspaceId, workspaceLabel: workspace.label,
    paneId: "agent-run:" + agentRun.id, paneLabel: "Exportación", agent: "codexp", lastSeenAt: now - 3_600_000,
    agentRun,
  };
  if (fixtureKiroChat.page !== "live") throw new Error("Expected a live chat fixture");
  const upserts = [
    { role: "user" as const, text: "¿Puedes revisar las propuestas?" },
    { role: "assistant" as const, text: "Estoy comparando los dos diseños." },
  ].map(({ role, text }, i) => ({
    role, uuid: "fixture-message-" + i, seq: i + 1, ts: new Date(now - (2 - i) * 60_000).toISOString(),
    parts: [{ kind: "text" as const, text }],
  }));
  await installPaneWorld(page, {
    paneId: agents[0]!.paneId, snapshot: { ...fixtureSnapshot, agents, shellPanes: [run],
      workspaces: [workspace], ts: now, device: { enforced: true, authorized: true, device: "Janez" } },
    chat: { ...fixtureKiroChat, paneId: agents[0]!.paneId, oldest: 1, head: 2, upserts }, start: "idle",
    screens: { idle: paneCapture("kiro--v3-idle-w120") },
  });
  const progress = "Preparé la tabla de exportación.";
  const runChat = { ...fixtureKiroChat, paneId: run.paneId, oldest: 1, head: 2,
    upserts: [upserts[0]!, { ...upserts[1]!, parts: [{ kind: "text" as const, text: progress }] }] };
  await page.route(url => url.pathname === "/api/pane/" + encodeURIComponent(run.paneId) + "/chat",
    route => route.fulfill({ json: runChat }));
  await page.goto("/");
  const rows = page.getByRole("listitem").getByRole("button");
  await expect(rows).toHaveCount(agents.length + 1);
  return { agents, run, rows, progress, first: rows.filter({ hasText: "Orquestador" }) };
}

async function capture(page: Page, state: string) {
  const directory = process.env.BOT_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, test.info().project.name + "-" + state + ".png") });
}

// The pseudo-element has no accessible role. Inspect the browser's animation actually applied to it.
function ringStyle(owner: Locator, property: "animationPlayState" | "animationName" | "content") {
  return owner.locator("[data-activity][aria-hidden=true]").evaluate((el, key) => getComputedStyle(el, "::after")[key], property);
}

async function refresh(page: Page) {
  // Use the ordinary accelerated snapshot read without navigating away or reloading the document.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

function rowGeometry(rows: Locator) {
  return rows.evaluateAll(items => items.map(item => ({
    name: item.querySelector("strong")?.textContent,
    box: item.getBoundingClientRect().toJSON(),
  })));
}

test("changing activity preserves every row position and the chat header", async ({ page }) => {
  const { agents, run, rows, first } = await openActivityFixture(page);
  const search = page.getByRole("searchbox", { name: "Buscar" });
  for (const [i, label] of ["Trabajando…", "Ya compartí las dos propuestas.", "Te necesita", "Se detuvo", "Listo", "Trabajando…"].entries()) {
    await expect(rows.nth(i)).toContainText(label);
  }
  await capture(page, "lista");
  const before = await rowGeometry(rows);
  const searchBefore = await search.boundingBox();
  const original = await first.elementHandle();
  agents[0]!.status = "idle";
  const seen = Date.now();
  agents[3]!.lastSeenAt = seen;
  agents[4]!.lastSeenAt = seen;
  run.agentRun.status = "done";
  run.agentRun.end = seen;
  await refresh(page);
  await expect(first).toContainText("Estoy comparando los dos diseños.");
  await expect(rows.nth(3)).not.toContainText("Se detuvo");
  await expect(rows.nth(4)).not.toContainText("Listo");
  await expect(rows.nth(5)).toContainText("Listo");
  expect(await rowGeometry(rows)).toEqual(before);
  expect(await search.boundingBox()).toEqual(searchBefore);
  expect(await original.evaluate(el => el.isConnected)).toBe(true);

  await first.click();
  const header = page.getByRole("button", { name: "Opciones del chat" }).locator("..");
  const pill = header.getByText("Orquestador", { exact: true }).locator("..");
  await expect(header).toBeInViewport({ ratio: 1, timeout: 30_000 });
  const headerBefore = await header.boundingBox();
  const pillBefore = await pill.boundingBox();
  const opened = await header.elementHandle();
  for (const [status, expected] of [["working", "working"], ["blocked", "blocked"], ["blocked", "error"], ["idle", "idle"]] as const) {
    agents[0]!.status = status;
    if (expected === "error") agents[0]!.blockedBy = "error";
    else delete agents[0]!.blockedBy;
    await refresh(page);
    await expect(pill.locator("[data-activity]")).toHaveAttribute("data-activity", expected);
    if (status === "working") {
      await expect.poll(() => ringStyle(pill, "animationName")).not.toBe("none");
      await capture(page, "header");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect.poll(() => ringStyle(pill, "animationName")).toBe("none");
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }
    expect(await header.boundingBox()).toEqual(headerBefore);
    expect(await pill.boundingBox()).toEqual(pillBefore);
  }
  expect(await opened.evaluate(el => el.isConnected)).toBe(true);
});

test("a headless run keeps its duration, stop control and live portrait", async ({ page }) => {
  const { rows, run, progress } = await openActivityFixture(page);
  const row = rows.filter({ hasText: "Exportación" });
  await expect(row).toContainText(/Trabajando… · \d+ min/);
  await row.click();
  const header = page.getByRole("button", { name: "Volver a los chats" }).locator("..");
  await expect(header).toBeInViewport({ ratio: 1, timeout: 30_000 });
  const pill = header.getByText("Exportación", { exact: true }).locator("..");
  await expect(pill.getByRole("status")).toHaveText("Trabajando…");
  await expect.poll(() => ringStyle(pill, "animationName")).not.toBe("none");
  const stop = page.getByRole("button", { name: "Detener", exact: true });
  await expect(stop).toBeEnabled();
  await expect(stop.locator("..")).toContainText(/Corriendo · \d+ min/);
  await expect(page.getByText(progress, { exact: true })).toBeVisible();
  await expect.poll(() => page.locator(".bot-detail").evaluate(el => getComputedStyle(el).transform)).toBe("none");
  const runGeometry = await page.locator(".bot-agent-run").evaluate(root => {
    const reader = root.querySelector('[data-slot="session-stream"]')!.getBoundingClientRect();
    const bar = root.querySelector(".agent-run-bar")!.getBoundingClientRect();
    const foot = root.querySelector(".agent-run-bottom")!;
    const footer = foot.getBoundingClientRect();
    const style = getComputedStyle(foot);
    return { top: reader.top - bar.top, bottom: reader.bottom - footer.bottom,
      standard: style.getPropertyValue("backdrop-filter"), webkit: style.getPropertyValue("-webkit-backdrop-filter") };
  });
  expect(runGeometry.top).toBeLessThanOrEqual(0);
  expect(runGeometry.bottom).toBeGreaterThanOrEqual(0);
  expect(runGeometry.standard).toContain("blur(24px)");
  // Chromium keeps only the standard property in computed style.
  expect(runGeometry.webkit || runGeometry.standard).toContain("blur(24px)");
  await capture(page, "header-run");

  run.agentRun.status = "done";
  run.agentRun.end = Date.now();
  run.lastSeenAt = run.agentRun.end;
  await refresh(page);
  await expect(pill.locator("[data-activity]")).toHaveAttribute("data-activity", "idle");
  await expect(stop).toHaveCount(0);
  await header.getByRole("button", { name: "Volver a los chats" }).click();
  await expect(row).toContainText(progress);
  await expect(row.locator("[data-activity][aria-hidden=true]")).toHaveAttribute("data-activity", "idle");
});

test("working motion respects reduced motion, visibility and the silent idle deadline", async ({ page }) => {
  await page.clock.install();
  const { first } = await openActivityFixture(page);
  await expect(first).toContainText("Trabajando…");
  await expect.poll(() => ringStyle(first, "animationName")).not.toBe("none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => ringStyle(first, "animationName")).toBe("none");
  await expect(first).toContainText("Trabajando…");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Simulate the visibility signals since WebKit has no portable background-tab control.
  for (const hidden of [true, false]) {
    await page.evaluate(value => {
      Object.defineProperty(document, "hidden", { configurable: true, value });
      Object.defineProperty(document, "visibilityState", { configurable: true, value: value ? "hidden" : "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
    await expect.poll(() => ringStyle(first, "animationPlayState")).toBe(hidden ? "paused" : "running");
  }
  await page.clock.fastForward(31 * 60_000);
  await expect.poll(() => ringStyle(first, "animationPlayState")).toBe("paused");
  await page.getByRole("searchbox", { name: "Buscar" }).click();
  await expect.poll(() => ringStyle(first, "animationPlayState")).toBe("running");
});


test("ready avatars have no circular outline while working avatars keep their indicator", async ({ page }) => {
  const { rows, first } = await openActivityFixture(page);
  await expect.poll(() => ringStyle(rows.filter({ hasText: "Bitácora" }), "content")).toBe("none");
  await expect.poll(() => ringStyle(first, "content")).toBe('""');
});
