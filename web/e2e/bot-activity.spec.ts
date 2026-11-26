import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { AgentView } from "@/lib/types";
import { fixtureAgents, fixtureKiroChat, fixtureShellPanes, fixtureSnapshot } from "@/test/handlers";
import { installApiStub, installPaneWorld, paneCapture, pinLocale } from "./fixtures/api";

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
  const agents: AgentView[] = portraits.map((portrait, i) => ({
    ...fixtureAgents[0]!, agent: "kiro", ...portrait, workspaceLabel: workspace.label,
    paneId: workspace.workspaceId + ":p" + (i + 1), terminalId: "fixture-activity-" + i,
    lastActiveAt: now - (i + 1) * 60_000, lastSeenAt: now - 3_600_000,
  }));
  const agentRun: { id: string; status: "running" | "done"; start: number; end: number | null } = {
    id: "fixture-export", status: "running", start: now - 60_000, end: null,
  };
  const run = {
    ...fixtureShellPanes[0]!, workspaceId: workspace.workspaceId, workspaceLabel: workspace.label,
    paneId: "w1:p6", paneLabel: "Exportación", terminalId: "fixture-run", lastSeenAt: now - 3_600_000,
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
  await page.goto("/");
  const rows = page.getByRole("listitem").getByRole("button");
  await expect(rows).toHaveCount(agents.length + 1);
  return { agents, run, rows, first: rows.filter({ hasText: "Orquestador" }) };
}

async function capture(page: Page, state: string) {
  const directory = process.env.BOT_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, test.info().project.name + "-" + state + ".png") });
}

// The pseudo-element has no accessible role. Inspect the browser's animation actually applied to it.
function ringStyle(owner: Locator, property: "animationPlayState" | "animationName") {
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
  await expect(header).toBeInViewport({ ratio: 1 });
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
