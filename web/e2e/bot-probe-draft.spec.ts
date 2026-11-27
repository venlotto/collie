// A Codex 0.172.0 box that stopped every send (live, 2026-11-27, codexp on an iPhone). (1) A draft that ends
// in a mention, `mira @READ`: the next send typed Collie's check character after it, Codex reopened its file
// list and the send ended `probe_failed` with `mira @READ⌁` left in the box. The bridge now types nothing
// there and answers `draft_present` with Replace and Cancel only (Add would extend the mention). (2) Shell
// mode: after `!echo hola-bang` every send was `refused unconfirmed` with no key. A shell line is sent now,
// and a box Collie cannot take out of shell mode is refused with the cause `shell_mode`. These cases stub
// the bridge with those answers and check what the person sees, in Spanish.
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { JsonObject } from "@/lib/json";
import type { Surface } from "@/lib/surface/surface";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot, sendAnswer } from "@/test/handlers";
import { installApiStub, installPaneWorld, pinLocale } from "./fixtures/api";

const expect = baseExpect.configure({ timeout: 15_000 });
test.use({ serviceWorkers: "block" });

const DRAFT: Surface = { revision: 4, turn: "idle", modal: "none", composer: "draft" };
const FREE: Surface = { revision: 6, turn: "idle", modal: "none", composer: "empty" };
const NEW = "Responde solo OK-A3";
const SHELL_LINE = "The box is in the agent's shell mode, where Enter would run your text as a shell command, and it did not leave it. Nothing was typed. Leave shell mode on the key pad (Backspace on the empty box), then send again.";
const capture = (name: string): string => readFileSync(new URL(`../../bridge/surface/captures/${name}`, import.meta.url), "utf8");

async function shot(page: Page, name: string) {
  const dir = process.env.BOT_SCREENSHOTS;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  const device = test.info().project.name === "phone-webkit" ? "iphone-webkit" : "desktop";
  await page.screenshot({ path: join(dir, device + "-" + name + ".png"), scale: "css", animations: "disabled" });
}

interface Post {
  readonly id: string;
  readonly text: string;
  readonly mode: string;
}

type Screen = "mention" | "shell" | "idle";

/** A Codex bot whose box shows `start` (a real 0.172.0 capture); `answer` is the stub bridge. */
async function openCodex(page: Page, start: Screen, answer: (post: Post, n: number, show: (screen: Screen) => void) => JsonObject) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const agent = { ...fixtureAgents[0]!, agent: "codex", kind: "agent" as const, status: "idle" as const, surface: start === "mention" ? DRAFT : FREE,
    hasSession: true, paneLabel: "codexp", terminalId: "probe-draft-codex" };
  const snapshot = { ...fixtureSnapshot, agents: [agent], shellPanes: [], ts: Date.now(),
    device: { authorized: true, enforced: true, device: "Campo" } };
  const world = await installPaneWorld(page, { paneId: agent.paneId, snapshot,
    chat: { ...fixtureKiroChat, paneId: agent.paneId },
    screens: {
      mention: capture("codex--v0172-mention-draft--w56.txt"),
      shell: capture("codex--v0172-shell-mode-empty--w56.txt"),
      idle: capture("codex--v0172-shell-mode-empty--w56.txt").replace(/^.*!.*$/mu, "› Ask Codex to do anything"),
    }, start });
  const posts: Post[] = [];
  await page.route(url => url.pathname === "/api/send", async route => {
    // SAFETY: this isolated browser's only caller is lib/api.ts's Send Protocol request.
    const body = route.request().postDataJSON() as Post;
    posts.push(body);
    await route.fulfill({ json: answer(body, posts.length, world.show) });
  });
  await page.goto("/pane/" + encodeURIComponent(agent.paneId));
  const field = page.locator('[data-slot="composer-box"] textarea').first();
  await expect(field).toBeVisible();
  return { field, posts };
}

/** Waits until a sliding notice or sheet stands still, so the evidence shot is not taken mid-slide. */
async function settled(locator: ReturnType<Page["locator"]>) {
  let last = -1;
  await expect.poll(async () => {
    const y = (await locator.boundingBox())?.y ?? -2;
    const still = y === last;
    last = y;
    return still;
  }, { intervals: [250] }).toBe(true);
}

test("a draft that ends in a mention: the draft sheet offers Replace and Cancel, no Add, and Replace sends", async ({ page }) => {
  const { field, posts } = await openCodex(page, "mention", (post, n, show) => {
    // The fixed bridge: no key at all, the draft's own text, Replace and Cancel.
    if (n === 1) return { ...sendAnswer(post.id, "refused", "draft_present", { offers: ["replace", "cancel"], rowsHash: "rows-mention", surface: DRAFT, detail: "The box already holds a draft." }), draftText: "mira @READ" };
    show("idle");
    return sendAnswer(post.id, "sent", undefined, { surface: FREE });
  });
  await field.fill(NEW);
  await page.locator('[data-slot="composer-primary"]').click();
  const sheet = page.locator('[data-slot="send-offer-modal"]');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("El cuadro ya contiene un borrador");
  await expect(sheet).toContainText("mira @READ");
  await expect(sheet.getByRole("button", { name: /Reemplazar/u })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Añadir/u })).toHaveCount(0);
  await expect(sheet).not.toContainText("La tecla de prueba");
  await expect(sheet).not.toContainText("⌁");
  await settled(sheet);
  await shot(page, "01-mention-draft-sheet");
  await sheet.getByRole("button", { name: /Reemplazar/u }).click();
  await expect.poll(() => posts.map(post => post.mode)).toEqual(["send", "replace"]);
  expect(posts[1]?.text).toBe(NEW);
  await expect(sheet).toBeHidden();
  await expect(field).toHaveValue("");
  await expect(page.locator('[data-slot="cannot-tell-card"]')).toHaveCount(0);
  await shot(page, "02-mention-replace-sent");
});

test("a shell line is sent as a command and clears the field", async ({ page }) => {
  const { field, posts } = await openCodex(page, "idle", (post, _n, show) => {
    show("idle");
    return sendAnswer(post.id, "sent", undefined, { surface: FREE });
  });
  await field.fill("!echo hola-bang");
  await page.locator('[data-slot="composer-primary"]').click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]?.mode).toBe("command");
  expect(posts[0]?.text).toBe("!echo hola-bang");
  await expect(field).toHaveValue("");
  await expect(page.locator('[data-slot="composer-refusal"]')).toHaveCount(0);
  await shot(page, "03-shell-line-sent");
});

test("a box Collie cannot take out of shell mode says so in Spanish, with the key to press, and keeps the message", async ({ page }) => {
  const { field, posts } = await openCodex(page, "shell", (post) => ({
    ...sendAnswer(post.id, "refused", "not_free", { offers: ["keys"], surface: FREE, detail: SHELL_LINE }),
    cause: "shell_mode",
  }));
  await field.fill(NEW);
  await page.locator('[data-slot="composer-primary"]').click();
  await expect.poll(() => posts.length).toBe(1);
  const notice = page.locator('[data-slot="composer-refusal"]').first();
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("modo Shell");
  await expect(notice).toContainText("Backspace");
  await expect(notice).toContainText("No se escribió nada");
  // Never the mute "cannot read this screen" of the live failure, and no English line under it.
  await expect(notice).not.toContainText("no puede leer");
  await expect(page.getByText("shell mode, where Enter")).toHaveCount(0);
  await expect(field).toHaveValue(NEW);
  await settled(notice);
  await shot(page, "04-shell-mode-notice");
});
