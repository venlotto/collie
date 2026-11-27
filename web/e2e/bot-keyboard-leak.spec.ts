import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Surface } from "@/lib/surface/surface";
import type { AgentView } from "@/lib/types";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot, fixtureWalkyAgent, sendAnswer } from "@/test/handlers";
import { installApiStub, installPaneWorld, paneCapture, pinLocale } from "./fixtures/api";

const FREE: Surface = { revision: 1, turn: "idle", modal: "none", composer: "empty" };
interface PostedSend { id: string; pane: string; text: string; mode: string }

async function openCodex(page: Page, withWalky = false) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const agent: AgentView = {
    ...fixtureAgents[0]!, agent: "codex", kind: "agent", status: "idle", surface: FREE,
    hasSession: true, paneLabel: "Codex desechable", workspaceLabel: "Teclado",
  };
  const snapshot = { ...fixtureSnapshot, agents: [agent], shellPanes: [], ts: Date.now(),
    device: { enforced: true, authorized: true, device: "Fixture" } };
  const baseHead = "head" in fixtureKiroChat ? fixtureKiroChat.head : 0;
  const walkyEntry = {
    uuid: "walky-fixture", ts: "2026-10-17T09:30:00.000Z", role: "user" as const,
    parts: [{ kind: "text" as const, text: "[walky-talky wt_k3f9x2m8q1a0] from agent lodge/w6:p3 (claude, collie-workspace#fix-465)\nTests are green on fix-465. You can merge." }],
    seq: baseHead + 1,
  };
  const chat = {
    ...fixtureKiroChat, paneId: agent.paneId,
    upserts: withWalky ? [...fixtureKiroChat.upserts, walkyEntry] : fixtureKiroChat.upserts,
    head: withWalky ? walkyEntry.seq : baseHead,
  };
  const world = await installPaneWorld(page, {
    paneId: agent.paneId, snapshot, chat,
    screens: { idle: paneCapture("codex--v0172-agent-hint-idle") }, start: "idle",
  });
  if (withWalky) {
    await page.route(url => /^\/api\/pane\/[^/]+\/walky$/u.test(url.pathname),
      route => route.fulfill({ json: { messages: [fixtureWalkyAgent] } }));
  }
  const sends: PostedSend[] = [];
  const keys: unknown[] = [];
  await page.route(url => url.pathname === "/api/send", async route => {
    // SAFETY: the isolated fixture app's send protocol is the only caller of this route.
    const body = route.request().postDataJSON() as PostedSend;
    sends.push(body);
    await route.fulfill({ json: sendAnswer(body.id, "sent") });
  });
  await page.route(url => /^\/api\/pane\/[^/]+\/keys$/u.test(url.pathname), async route => {
    keys.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/pane/" + encodeURIComponent(agent.paneId));
  const field = page.getByRole("textbox");
  await expect(field).toBeVisible({ timeout: 15_000 });
  return { field, sends, keys, world };
}

async function shot(page: Page, name: string) {
  const directory = process.env.BOT_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const device = test.info().project.name === "phone-webkit" ? "iphone-webkit" : "desktop";
  await page.screenshot({ path: join(directory, `${device}-${name}.png`), scale: "css", animations: "disabled" });
}

const cases = [
  { id: "question", text: "?", mode: "send" },
  { id: "mention", text: "@x", mode: "command" },
  { id: "model-command", text: "/model", mode: "command" },
  { id: "shell-command", text: "!ls", mode: "command" },
  { id: "multiline", text: "primera línea\nsegunda línea\n\n@x ?", mode: "send" },
  { id: "long", text: "Revisa @src/app.ts ? ".repeat(20).trim(), mode: "send" },
] as const;

for (const item of cases) {
  test(`${item.id}: the composer sends text only through /api/send`, async ({ page }) => {
    const { field, sends, keys } = await openCodex(page);
    await expect(field).toHaveAttribute("autocapitalize", "none");
    await expect(field).toHaveAttribute("enterkeyhint", "enter");
    await field.fill(item.text);
    await shot(page, `${item.id}-draft`);
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect.poll(() => sends.length).toBe(1);
    expect(sends[0]).toMatchObject({ pane: "w1:p1", text: item.text, mode: item.mode });
    expect(keys).toEqual([]);
    await shot(page, `${item.id}-sent`);
  });
}

test("empty: no draft means no send and no terminal key", async ({ page }) => {
  const { field, sends, keys } = await openCodex(page);
  await expect(field).toHaveValue("");
  await expect(page.getByRole("button", { name: "Enviar", exact: true })).toHaveCount(0);
  await field.press("Enter");
  expect(sends).toEqual([]);
  expect(keys).toEqual([]);
  await shot(page, "empty");
});

test("an open Messages sheet never lets Ctrl+M focus the hidden composer", async ({ page }) => {
  const { field, keys } = await openCodex(page, true);
  await page.getByRole("button", { name: /Tests are green on fix-465.*Abrir en WalkyTalky/u }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await field.blur();
  await shot(page, "sheet-before-ctrl-m");
  await page.keyboard.press("Control+m");
  await expect(field).not.toBeFocused();
  await page.keyboard.type("?/@!");
  expect(keys).toEqual([]);
  await shot(page, "sheet-after-ctrl-m");
});

test("ordinary keys never leak; the double prefix is an explicit terminal key", async ({ page }) => {
  const { field, keys } = await openCodex(page);
  await field.pressSequentially("a");
  await field.blur();
  await page.keyboard.type("?/@!");
  expect(keys).toEqual([]);
  await shot(page, "unfocused-no-leak");
  await page.keyboard.press("Control+b");
  await page.keyboard.press("Control+b");
  await expect.poll(() => keys.length).toBe(1);
  expect(keys[0]).toMatchObject({ keys: ["ctrl+b"] });
  await shot(page, "explicit-double-prefix");
});

test("IME Enter and keyCode 229 do not send or leak a key", async ({ page }) => {
  const { field, sends, keys } = await openCodex(page);
  await field.fill("á");
  await field.evaluate(node => {
    node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "á" }));
    node.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 229, isComposing: true,
    }));
    node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "á" }));
  });
  expect(sends).toEqual([]);
  expect(keys).toEqual([]);
  await expect(field).toHaveValue("á");
  await shot(page, "ime-enter");
});
