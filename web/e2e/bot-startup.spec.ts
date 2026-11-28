// Real Codex startup capture; the stub checks reload/card wiring, the Bun lab measures delivery.
import { expect as baseExpect, test } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 15000 });
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentView } from "@/lib/types";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot } from "@/test/handlers";
import { installApiStub, installPaneWorld, pinLocale } from "./fixtures/api";

for (const kind of ["trust", "update"] as const) {
test(`startup hold survives reload beside the real ${kind} card in Messages`, async ({ page }, info) => {
  await pinLocale(page, "es");
  await installApiStub(page);
  const ask = { id: "startup-trust", kind: "permission" as const, channel: "keys" as const, hash: "startup-trust-hash",
    options: kind === "trust" ? [{ id: "1", label: "Trust and continue" }, { id: "2", label: "Back to Agent Command Center" }]
      : [{ id: "1", label: "Update now (runs `npm install -g @openai/codex`)" }, { id: "2", label: "Skip" }, { id: "3", label: "Skip until next version" }] };
  const agent: AgentView = { ...fixtureAgents[1]!, agent: "codex", status: "blocked", paneLabel: "codexp", hasSession: true, askRoute: true,
    surface: { revision: 1, turn: "unknown", composer: "unknown", modal: { ask } },
    held: [{ requestId: "startup-message", mode: "send", text: "Responde ARRANQUE_OK", state: "held", cause: "starting", heldAt: Date.now(), expiresAt: Date.now() + 120000 }] };
  const snapshot = { ...fixtureSnapshot, agents: [agent], shellPanes: [], ts: Date.now(), device: { authorized: true, enforced: true, device: "Campo" } };
  const capture = readFileSync(new URL(`../../bridge/surface/captures/codex--v0172-startup-${kind}--w52.txt`, import.meta.url), "utf8");
  await installPaneWorld(page, { paneId: agent.paneId, snapshot, chat: { ...fixtureKiroChat, upserts: [] }, screens: { trust: capture }, start: "trust" });
  const answers: unknown[] = [];
  await page.route(url => url.pathname === "/api/ask/startup-trust", async route => {
    answers.push(route.request().postDataJSON());
    await route.fulfill({ json: { outcome: "sent" } });
  });
  await page.goto("/");
  await page.locator(".bot-row").first().click();
  await expect(page.getByRole("button", { name: "Opciones del chat" })).toBeVisible();
  const trust = page.getByRole("button", { name: kind === "trust" ? /Trust and continue/ : /Skip$/ });
  await expect(trust).toBeVisible();
  await expect(page.getByText("Responde ARRANQUE_OK", { exact: true })).toBeVisible();
  await page.reload();
  await expect(trust).toBeVisible();
  await expect(page.getByText("Responde ARRANQUE_OK", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox").first()).not.toHaveAttribute("placeholder", /COLLIE_SEND_PROTOCOL/);
  if (process.env.BOT_SCREENSHOTS) {
    await mkdir(process.env.BOT_SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: join(process.env.BOT_SCREENSHOTS, `${info.project.name}-startup-${kind}-reload.png`), animations: "disabled" });
  }
  await trust.click();
  await expect.poll(() => answers.length).toBe(1);
  expect(answers[0]).toMatchObject({ pane: agent.paneId, optionId: kind === "trust" ? "1" : "2", hash: ask.hash, origin: "person_tap" });
});

}
