import { expect as baseExpect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot } from "@/test/handlers";
import { installApiStub, installPaneWorld, pinLocale } from "./fixtures/api";

// The desk (local patch): several chats open side by side on a wide screen. Real layout is the claim
// (windows side by side, the tray under them, the focus edge), so it needs an engine.

const expect = baseExpect.configure({ timeout: 15_000 });
const NAMES = ["Alfa", "Beta", "Gamma"] as const;

async function shot(page: Page, name: string) {
  const dir = process.env.BOT_SCREENSHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  const device = test.info().project.name === "phone-webkit" ? "iphone-webkit" : "escritorio";
  await page.screenshot({ path: join(dir, device + "-mesa-" + name + ".png"), scale: "css", animations: "disabled" });
}

async function setup(page: Page) {
  await pinLocale(page, "es");
  await installApiStub(page);
  // Three agents: the fixture has two, so the third is the first one moved to a space of its own.
  const third = { ...fixtureAgents[0]!, paneId: "w3:p1", workspaceId: "w3", workspaceLabel: "viajes", workspaceNumber: 3, tabId: "w3:t1" };
  const agents = NAMES.map((name, i) => Object.assign({}, [...fixtureAgents, third][i]!, { paneLabel: name, hasSession: true,
    terminalId: "desk-" + String(i), focused: false, status: "idle" as const }));
  const workspaces = [...fixtureSnapshot.workspaces, { ...fixtureSnapshot.workspaces[0]!, workspaceId: "w3", number: 3, label: "viajes", activeTabId: "w3:t1" }];
  const snapshot = { ...fixtureSnapshot, agents, shellPanes: [], workspaces, ts: Date.now(),
    device: { authorized: true, enforced: true, device: "Campo" } };
  for (const agent of agents) {
    await installPaneWorld(page, { paneId: agent.paneId, snapshot, chat: fixtureKiroChat,
      screens: { idle: "› Ask the fixture bot anything" }, start: "idle" });
  }
  return agents;
}

const row = (page: Page, name: string) => page.locator(".bot-row").filter({ hasText: name });
const win = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(name) });
const tray = (page: Page) => page.getByRole("navigation", { name: "Chats minimizados" });

test.describe("en una pantalla ancha", () => {
  test.beforeEach(() => test.skip(test.info().project.name === "phone-webkit", "the desk is a wide-screen layout"));
  test.use({ viewport: { width: 1600, height: 950 } });

  test("un borrador sigue visible al abrir otro chat y vuelve completo al editor", async ({ page }) => {
    await setup(page);
    await page.goto("/");
    await row(page, "Alfa").click();
    const draft = "Primera parte del mensaje\n\nSegunda parte pendiente";
    await page.locator("textarea").fill(draft);
    await row(page, "Beta").click();
    const preview = win(page, "Alfa").getByRole("textbox");
    await expect(preview).toHaveValue(draft);
    const bounds = await preview.boundingBox();
    const pane = await win(page, "Alfa").boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(pane!.y + pane!.height);
    await page.reload();
    await expect(preview).toHaveValue(draft);
    await preview.click();
    await expect(win(page, "Alfa").locator("textarea")).toHaveValue(draft);
    await expect(win(page, "Alfa").locator("textarea")).toBeFocused();
    await shot(page, "borrador-restaurado");
  });

  test("varios bots a la vez: abrir, minimizar, maximizar, restaurar, cerrar y recordar", async ({ page }) => {
    const agents = await setup(page);
    await page.goto("/");

    // One chat is the single screen it always was.
    await row(page, "Alfa").click();
    await expect(page.getByRole("button", { name: "Volver a los chats" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Minimizar" })).toHaveCount(0);

    // A second chat opens beside it, and the first stays live.
    await row(page, "Beta").click();
    await expect(win(page, "Alfa")).toBeVisible();
    await expect(win(page, "Beta")).toBeVisible();
    await expect(page.getByRole("button", { name: "Volver a los chats" })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(agents[1]!.paneId)));
    const [a, b] = [await win(page, "Alfa").boundingBox(), await win(page, "Beta").boundingBox()];
    expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    await expect(win(page, "Alfa").getByRole("textbox", { name: /Preguntar a/ })).toBeVisible();
    await shot(page, "dos");

    await row(page, "Gamma").click();
    await expect(win(page, "Gamma")).toBeVisible();
    await expect(page.getByRole("button", { name: "Minimizar" })).toHaveCount(3);
    await shot(page, "tres");

    // Minimise: into the tray, and back with one click.
    await win(page, "Alfa").getByRole("button", { name: "Minimizar" }).click();
    await expect(win(page, "Alfa")).toHaveCount(0);
    await expect(tray(page).getByRole("button", { name: /Alfa/ })).toBeVisible();
    await shot(page, "minimizado");

    // Maximise: one window fills the desk, the others wait in the tray.
    await win(page, "Beta").getByRole("button", { name: "Maximizar" }).click();
    await expect(win(page, "Gamma")).toHaveCount(0);
    await expect(tray(page).getByRole("button")).toHaveCount(2);
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(agents[1]!.paneId)));
    await shot(page, "maximizado");
    await win(page, "Beta").getByRole("button", { name: "Restaurar" }).click();
    await expect(win(page, "Gamma")).toBeVisible();

    await tray(page).getByRole("button", { name: /Alfa/ }).click();
    await expect(win(page, "Alfa")).toBeVisible();
    await expect(tray(page)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(agents[0]!.paneId)));

    // The reply box of a window without the focus hands it the focus and the cursor.
    await win(page, "Gamma").getByRole("textbox", { name: /Preguntar a/ }).click();
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(agents[2]!.paneId)));
    await expect(win(page, "Gamma").locator("textarea")).toBeFocused();

    // Close takes the window off the desk only: the bot stays in the list.
    await win(page, "Beta").getByRole("button", { name: "Cerrar ventana" }).click();
    await expect(win(page, "Beta")).toHaveCount(0);
    await expect(row(page, "Beta")).toBeVisible();

    // The desk is remembered on this device.
    await page.reload();
    await expect(win(page, "Alfa")).toBeVisible();
    await expect(win(page, "Gamma")).toBeVisible();
    await shot(page, "recargado");

    // Down to one window, the chat is the single screen again, Back included.
    await win(page, "Alfa").getByRole("button", { name: "Cerrar ventana" }).click();
    await expect(page.getByRole("button", { name: "Volver a los chats" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Minimizar" })).toHaveCount(0);
  });

  test("una pantalla sin sitio para dos chats sigue con un solo chat", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await setup(page);
    await page.goto("/");
    await row(page, "Alfa").click();
    await row(page, "Beta").click();
    await expect(page.getByRole("button", { name: "Volver a los chats" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Minimizar" })).toHaveCount(0);
  });
});
