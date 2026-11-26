import { expect, test } from "@playwright/test";

import { es } from "@/lib/i18n/messages/es";
import type { AgentView, SnapshotResponse } from "@/lib/types";
import { fixtureAgents, fixtureSnapshot } from "@/test/handlers";
import { installApiStub, paneCapture, pinLocale } from "./fixtures/api";

// A delivered send must not leave the unread-screen sheet over Codex's live composer. The Working
// capture is the real 56-column frame whose thread title wraps onto a field-only second row; the
// unread capture is a dialog no grammar reads. Only a browser shows the sheet the person actually
// gets, in Spanish, at the phone and desktop layouts. Every response comes from the fixture stub.
//
// The tablet project is reused at the desktop viewport for this layout case. The phone case runs on
// WebKit with the config's real iPhone descriptor; no live bridge or pane is involved.

test.use({ serviceWorkers: "block" });

const IDLE = paneCapture("codex--v0166-core-idle-status-wrap--w56");
const WORKING = paneCapture("codex--astra-working-status-title-wrap--w56");
const UNREAD = paneCapture("codex--v0167-command-center--w120");
const PANE_ID = fixtureAgents[1]!.paneId;
const CAPTION = es["unreadDialog.caption"];

function pane(delivered: boolean, unread = false): AgentView {
  return {
    ...fixtureAgents[1]!,
    status: unread ? "blocked" : delivered ? "working" : "idle",
    surface: unread
      ? { revision: 1, turn: "idle", modal: "unreadable", composer: "unreachable" }
      : { revision: delivered ? 2 : 1, turn: delivered ? "running" : "idle", modal: "none", composer: "empty" },
  };
}

function world(agent: AgentView): SnapshotResponse {
  return { ...fixtureSnapshot, agents: [agent], shellPanes: [] };
}

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === "app-tablet") await page.setViewportSize({ width: 1440, height: 900 });
  await installApiStub(page);
  await pinLocale(page, "es");
});

test("a delivered send shows Codex Working and never opens the unread sheet", async ({ page }, testInfo) => {
  let delivered = false;
  let posts = 0;
  let workingReads = 0;
  await page.route((url) => url.pathname === "/api/snapshot", (route) =>
    route.fulfill({ json: world(pane(delivered)) }),
  );
  await page.route((url) => url.pathname === `/api/pane/${encodeURIComponent(PANE_ID)}`, (route) => {
    if (delivered) workingReads += 1;
    return route.fulfill({
      json: { paneId: PANE_ID, text: delivered ? WORKING : IDLE, truncated: false, revision: delivered ? 2 : 1 },
    });
  });
  await page.route((url) => url.pathname === "/api/send", (route) => {
    posts += 1;
    delivered = true;
    return route.fulfill({ json: { receipt: { outcome: "sent", keys: [] }, offers: [] } });
  });
  await page.goto(`/pane/${encodeURIComponent(PANE_ID)}`);

  const field = page.getByRole("textbox", { name: /^Preguntar a /u });
  await expect(field).toBeVisible();
  await field.fill("Explica el estado actual");
  await page.getByRole("button", { name: es["composer.send.sendAria"], exact: true }).click();
  await expect.poll(() => posts).toBe(1);
  await expect(field).toHaveValue("");
  await expect.poll(() => workingReads).toBeGreaterThan(0);
  await expect(page.getByText("Trabajando…", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(CAPTION, { exact: true })).toHaveCount(0);
  // Let the next poll arrive too: the Working frame is the response to the delivered send, not a
  // one-render assertion on the idle screen that happened to precede it.
  await page.waitForTimeout(1200);
  await expect(page.getByText(CAPTION, { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("delivered-working-es.png"), fullPage: true });
});

test("a genuinely unread dialog keeps the sheet, fully translated into Spanish", async ({ page }, testInfo) => {
  await page.route((url) => url.pathname === "/api/snapshot", (route) =>
    route.fulfill({ json: world(pane(false, true)) }),
  );
  await page.route((url) => url.pathname === `/api/pane/${encodeURIComponent(PANE_ID)}`, (route) =>
    route.fulfill({ json: { paneId: PANE_ID, text: UNREAD, truncated: false, revision: 1 } }),
  );
  await page.goto(`/pane/${encodeURIComponent(PANE_ID)}`);

  const sheet = page.getByLabel(CAPTION);
  await expect(sheet.getByText(CAPTION, { exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Esc", exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: es["unreadDialog.typeAnyway"] })).toBeVisible();
  await expect(sheet.getByRole("button", { name: es["unreadDialog.report"] })).toBeVisible();
  await expect(sheet.getByRole("button", { name: es["dialog.putAwayControlAria"] })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("genuinely-unread-es.png"), fullPage: true });
});
