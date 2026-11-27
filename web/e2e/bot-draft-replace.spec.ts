// Replace over a stuck Codex draft (live, 2026-11-27, codexp on an iPhone): the draft sheet's Replace
// emptied the box and never typed the new message, and the phone said "Collie no puede saber si esto
// llegó" with "Llegó / Enviar de nuevo". The bridge now ends that run `sent`, or, when the draft does not
// empty, `refused` with the cause `not_emptied`. These cases stub the bridge with those answers and check
// what the person sees: no "cannot tell" card, the message kept where it was not typed, and Spanish only
// under a Spanish notice (the bridge's English line no longer shows there).
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { JsonObject } from "@/lib/json";
import type { Surface } from "@/lib/surface/surface";
import { fixtureAgents, fixtureKiroChat, fixtureSnapshot, sendAnswer } from "@/test/handlers";
import { installApiStub, installPaneWorld, paneCapture, pinLocale } from "./fixtures/api";

const expect = baseExpect.configure({ timeout: 15_000 });
test.use({ serviceWorkers: "block" });

const DRAFT: Surface = { revision: 4, turn: "idle", modal: "none", composer: "draft" };
const FREE: Surface = { revision: 6, turn: "idle", modal: "none", composer: "empty" };
const STUCK = Array.from({ length: 8 }, () => "Explica en una frase por que el cielo es azul.").join(" ");
const NEW = "Responde solo OK-R2";
const PROBE_LINE = "The probe character changed more than the box. A probe character (⌁) may remain in the box. Check the pane before you type.";

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

/** A Codex bot whose box holds the 376-character draft the live phone met; `answer` is the stub bridge. */
async function openCodex(page: Page, answer: (post: Post, n: number, show: (screen: "idle" | "draft") => void) => JsonObject) {
  await pinLocale(page, "es");
  await installApiStub(page);
  const agent = { ...fixtureAgents[0]!, agent: "codex", kind: "agent" as const, status: "idle" as const, surface: DRAFT,
    hasSession: true, paneLabel: "codexp", terminalId: "draft-replace-codex" };
  const snapshot = { ...fixtureSnapshot, agents: [agent], shellPanes: [], ts: Date.now(),
    device: { authorized: true, enforced: true, device: "Campo" } };
  const world = await installPaneWorld(page, { paneId: agent.paneId, snapshot,
    chat: { ...fixtureKiroChat, paneId: agent.paneId },
    screens: { idle: paneCapture("codex--v0157-idle-50"), draft: readFileSync(new URL("../../bridge/surface/captures/codex--v0172-draft-376--w56.txt", import.meta.url), "utf8") }, start: "draft" });
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

/** The bridge's draft refusal over the stuck draft, with its quote and rows hash. */
function draftRefusal(id: string, extra: JsonObject = {}): JsonObject {
  return { ...sendAnswer(id, "refused", "draft_present", { offers: ["append", "replace", "cancel"], rowsHash: "rows-draft", surface: DRAFT, detail: "The box already holds a draft." }), draftText: STUCK, ...extra };
}

async function sendAndOpenSheet(page: Page, field: ReturnType<Page["locator"]>) {
  await field.fill(NEW);
  await page.locator('[data-slot="composer-primary"]').click();
  const sheet = page.locator('[data-slot="send-offer-modal"]');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("El cuadro ya contiene un borrador");
  return sheet;
}

test("Replace over the stuck draft sends the new message, with no 'cannot tell' card", async ({ page }) => {
  const { field, posts } = await openCodex(page, (post, n, show) => {
    if (n === 1) return draftRefusal(post.id);
    // The fixed bridge: the draft emptied, the message typed and sent.
    show("idle");
    return sendAnswer(post.id, "sent", undefined, { surface: FREE });
  });
  const sheet = await sendAndOpenSheet(page, field);
  await shot(page, "01-draft-sheet");
  await sheet.getByRole("button", { name: /Reemplazar/u }).click();
  await expect.poll(() => posts.map(post => post.mode)).toEqual(["send", "replace"]);
  expect(posts[1]?.text).toBe(NEW);
  await expect(sheet).toBeHidden();
  await expect(field).toHaveValue("");
  await expect(page.locator('[data-slot="cannot-tell-card"]')).toHaveCount(0);
  await expect(page.getByText("Collie no puede saber si esto llegó")).toHaveCount(0);
  await shot(page, "02-replace-sent");
});

test("a Replace whose draft did not empty says the message was not typed, keeps it, and offers the draft again", async ({ page }) => {
  const { field, posts } = await openCodex(page, (post, n) => {
    if (n === 1) return draftRefusal(post.id);
    // The bridge could not empty the box: part of the draft is left, offered again with its own rows hash.
    return draftRefusal(post.id, {
      receipt: { requestId: post.id, outcome: "refused", reason: "draft_present", keys: [] },
      cause: "not_emptied", rowsHash: "rows-left", draftText: STUCK.slice(0, 100),
      detail: "Collie could not empty the draft, so your message was not typed. Check the box, then send again. The box did not empty inside the bound.",
    });
  });
  const sheet = await sendAndOpenSheet(page, field);
  await sheet.getByRole("button", { name: /Reemplazar/u }).click();
  await expect.poll(() => posts.length).toBe(2);
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("no pudo vaciar el borrador, así que tu mensaje no se escribió");
  await expect(sheet).not.toContainText("El cuadro contenía un borrador");
  await expect(sheet).not.toContainText("could not empty");
  await expect(field).toHaveValue(NEW);
  await expect(page.locator('[data-slot="cannot-tell-card"]')).toHaveCount(0);
  await shot(page, "03-replace-not-emptied");
});

test("a Spanish notice shows no English line under it", async ({ page }) => {
  const { field, posts } = await openCodex(page, (post) =>
    // The live answer of 2026-11-27: a probe that changed more than the box, its English line under it.
    sendAnswer(post.id, "refused", "probe_failed", { offers: ["keys"], surface: { ...FREE, modal: "unreadable" }, detail: PROBE_LINE }),
  );
  await field.fill(NEW);
  await page.locator('[data-slot="composer-primary"]').click();
  await expect.poll(() => posts.length).toBe(1);
  const notice = page.locator('[data-slot="composer-refusal"]').first();
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("La tecla de prueba de Collie no llegó");
  const detail = page.locator('[data-slot="composer-refusal-detail"]').first();
  await expect(detail).toHaveText("Puede que un carácter de prueba de Collie siga en la caja. Revisa el panel antes de escribir.");
  // The notice slides in above the composer: the evidence shot waits until it stands still.
  let last = -1;
  await expect.poll(async () => {
    const y = (await notice.boundingBox())?.y ?? -2;
    const still = y === last;
    last = y;
    return still;
  }, { intervals: [250] }).toBe(true);
  await shot(page, "04-notice-es");
  await expect(page.getByText("may remain in the box")).toHaveCount(0);
  await expect(page.getByText("The probe character")).toHaveCount(0);
});
