// After bun run build: BOT_SCREENSHOTS=<directory> bun web/e2e/manual/bot-send.mjs
// Each browser gets a paired bridge and a private tmux socket. There is no target URL argument.
import { chromium, devices, expect, webkit } from "@playwright/test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { ScratchBridge } from "../../../scripts/harness-canary/lab/phone-bridge.ts";
import { LabTmux, shellWord } from "../../../scripts/harness-canary/lab/tmux.ts";

const repo = join(import.meta.dirname, "../../..");
const pictures = process.env.BOT_SCREENSHOTS;
const sendPath = url => url.pathname === "/api/send";
const message = "¿Ya está listo el informe?";
const nextFrame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function checkDevice(phone) {
  const device = phone ? "iphone-webkit" : "escritorio";
  const root = mkdtempSync(join(tmpdir(), "collie-send-"));
  const mux = new LabTmux(basename(root));
  const received = join(root, "lines");
  const readLines = () => readFileSync(received, "utf8");
  const env = { PATH: "/usr/bin:/bin", HOME: root, SHELL: "/bin/bash", TERM: "xterm-256color", LANG: "C.UTF-8" };
  let bridge, browser;
  try {
    // Read each submitted line without executing it. An unsubmitted edit cannot reach the file.
    const rc = join(root, "bashrc");
    writeFileSync(rc, `while IFS= read -er -p 'Conversación > ' line; do printf '%s\\n' "$line" >> "$HOME/lines"; done\nexit\n`);
    writeFileSync(received, "");
    await mux.start(root, "exec /bin/bash --rcfile " + shellWord(rc) + " -i", env);
    bridge = await ScratchBridge.start({
      repoRoot: repo, root: join(root, "bridge"), tmuxSocket: mux.socket, tmuxBinary: mux.binaryPath(),
      agentBinDir: dirname(mux.binaryPath()), agentConfig: join(root, "agent"), env,
    }, () => {});
    expect((await fetch(bridge.url + "/api/snapshot")).status).toBe(403);

    browser = await (phone ? webkit : chromium).launch();
    const viewport = phone ? { width: 390, height: 844 } : { width: 1280, height: 800 };
    const page = await browser.newPage({
      ...(phone ? devices["iPhone 13"] : devices["Desktop Chrome"]), serviceWorkers: "block", viewport,
      // One-time bootstrap. Navigating again must not reinsert the credential.
      storageState: { cookies: [], origins: [{ origin: bridge.url, localStorage: [
        { name: "collie:device-token", value: bridge.token }, { name: "collie:locale:v1", value: "es" },
      ] }] },
    });
    const nativeDialogs = [];
    page.on("dialog", async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
    const shot = async name => {
      if (!pictures) return;
      mkdirSync(pictures, { recursive: true });
      await page.screenshot({ path: join(pictures, device + "-" + name + ".png"), scale: "css" });
    };
    await page.goto(bridge.url);
    await expect(page.locator(".bot-row")).toHaveCount(1);
    await page.locator(".bot-row").click();
    const box = page.locator('[data-slot="composer-box"]');
    const field = box.locator("textarea").first();
    const primary = box.locator('[data-slot="composer-primary"]');
    const wave = primary.locator("svg.lucide-audio-lines");
    const arrow = primary.locator("svg.lucide-arrow-up");
    const pending = page.locator('[data-slot="stream-pending"],[data-slot="mirror-pending"]');
    await expect(wave).toBeVisible();
    await expect(box.locator('[data-slot="composer-mic-draft"]')).toBeVisible();
    await expect.poll(() => page.locator(".bot-detail").evaluate(panel =>
      Math.abs(panel.getBoundingClientRect().left - panel.parentElement.getBoundingClientRect().left),
    )).toBeLessThan(0.1);
    await shot("onda");

    // Sample both edges during the swap. A transient shift must also fail.
    const sample = await box.evaluateHandle(element => {
      const frames = [];
      let id;
      function measure() {
        const { top, bottom } = element.getBoundingClientRect();
        frames.push({ top, bottom });
        id = requestAnimationFrame(measure);
      }
      measure();
      return () => { cancelAnimationFrame(id); return frames; };
    });
    await field.fill(message);
    await expect(arrow).toBeVisible();
    await expect(primary).toHaveCount(1);
    await expect(wave).toHaveCount(0);
    await expect(box.locator('[data-slot="composer-mic-draft"]')).toBeVisible();
    await nextFrame(page);
    const frames = await sample.evaluate(finish => finish());
    const spread = edge => Math.max(...frames.map(f => f[edge])) - Math.min(...frames.map(f => f[edge]));
    expect(spread("top")).toBeLessThan(0.51);
    expect(spread("bottom")).toBeLessThan(0.51);
    await shot("flecha");
    const measured = { frames: frames.length, topDelta: spread("top"), bottomDelta: spread("bottom") };

    const requests = [];
    page.on("request", r => {
      if (r.method() === "POST" && sendPath(new URL(r.url()))) requests.push(r.postDataJSON().text);
    });
    if (phone) {
      const bottomGap = () => box.evaluate(el => innerHeight - el.getBoundingClientRect().bottom);
      const closed = await bottomGap();
      await page.setViewportSize({ ...viewport, height: viewport.height - 300 });
      await nextFrame(page);
      const open = await bottomGap();
      expect(Math.abs(open - closed)).toBeLessThan(0.51);
      await field.press("Enter");
      await expect(field).toHaveValue(message + "\n");
      await page.setViewportSize(viewport);
      await nextFrame(page);
      const restored = await bottomGap();
      expect(Math.abs(restored - closed)).toBeLessThan(0.51);
      measured.keyboard = { shrink: 300, closedGap: closed, openGap: open, restoredGap: restored };
    } else {
      await field.press("Shift+Enter");
      await expect(field).toHaveValue(message + "\n");
    }
    expect(requests).toEqual([]);
    expect(readLines()).toBe("");
    await field.fill("");
    await expect(wave).toBeVisible();
    await field.fill(message);
    await expect(arrow).toBeVisible();

    // Hold the real write before the bridge can type or the terminal can render anything.
    let allow;
    const waitForDelivery = new Promise(resolve => { allow = resolve; });
    await page.route(sendPath, async route => { await waitForDelivery; await route.continue(); }, { times: 1 });
    const answer = page.waitForResponse(r => sendPath(new URL(r.url())) && r.request().method() === "POST");
    try {
      if (phone) {
        await page.setViewportSize({ ...viewport, height: viewport.height - 300 });
        await nextFrame(page);
        await primary.tap();
        await page.setViewportSize(viewport);
      } else await field.press("Enter");
      await expect(field).toHaveValue("");
      await expect(pending.filter({ hasText: message })).toBeVisible();
      await expect.poll(() => requests).toEqual([message]);
      expect(readLines()).toBe("");
      await shot("enviado");
    } finally {
      allow();
      await answer;
    }
    expect((await answer).status()).toBe(200);
    await expect.poll(readLines).toBe(message + "\n");
    await expect(wave).toBeVisible();
    const mirror = page.locator(".bot-terminal");
    await expect.poll(() => mirror.innerText().then(t => t.replace(/\s/gu, ""))).toContain(message.replace(/\s/gu, ""));
    await expect(pending).toHaveCount(0);

    // Inject an outage on one write. The previous line remains the pane's only input.
    const rejected = "Revisemos el borrador mañana.";
    await page.route(sendPath, route => route.fulfill({
      status: 503, contentType: "text/plain", body: "El pane de prueba no está disponible.",
    }), { times: 1 });
    await field.fill(rejected);
    if (phone) await primary.tap();
    else await primary.click();
    await expect(field).toHaveValue(rejected);
    const warning = page.getByRole("alert").locator('[data-slot="composer-refusal"]');
    await expect(warning).toBeInViewport();
    await expect(warning).toContainText(/.+/);
    await expect.poll(() => warning.evaluate(el => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(x + width / 2, y + height / 2));
    })).toBe(true);
    await expect(pending.filter({ hasText: rejected })).toHaveCount(0);
    expect(nativeDialogs).toEqual([]);
    expect(requests).toEqual([message, rejected]);
    expect(readLines()).toBe(message + "\n");
    await shot("error");
    const retry = page.waitForResponse(r => sendPath(new URL(r.url())) && r.request().postDataJSON()?.text === rejected);
    if (phone) await primary.tap();
    else await field.press("Enter");
    expect((await retry).status()).toBe(200);
    await expect.poll(readLines).toBe(message + "\n" + rejected + "\n");
    await expect(field).toHaveValue("");
    await expect(warning).toHaveCount(0);
    // Only this request loses its credential. The real pairing middleware must reject it.
    const unpaired = "Mensaje sin emparejar";
    await page.route(sendPath, route => {
      const headers = { ...route.request().headers() };
      delete headers.authorization;
      return route.continue({ headers });
    }, { times: 1 });
    await field.fill(unpaired);
    const denied = page.waitForResponse(r => sendPath(new URL(r.url())) && r.request().method() === "POST"
      && r.request().postDataJSON().text === unpaired);
    if (phone) await primary.tap();
    else await field.press("Enter");
    const response = await denied;
    expect(response.status()).toBe(403);
    expect((await response.text()).trim()).toBe("device not paired");
    // After the 403, the list explains how to pair.
    const access = page.locator(".bot-access");
    await expect(access).toContainText("Dispositivo sin emparejar");
    const pairLink = access.getByRole("link", { name: "Emparejar" });
    await expect(pairLink).toBeInViewport();
    await pairLink.click({ trial: true, timeout: 5000 });
    await shot("sin-emparejar");
    await expect(pending.filter({ hasText: unpaired })).toHaveCount(0);
    expect(readLines()).toBe(message + "\n" + rejected + "\n");
    if (pictures) writeFileSync(join(pictures, device + "-geometria.json"), JSON.stringify({ ...measured, samples: frames }, null, 2));
    console.log(device, "OK", JSON.stringify(measured));
  } finally {
    await browser?.close();
    const stopped = await bridge?.stop();
    const muxStopped = await mux.stop();
    rmSync(root, { recursive: true, force: true });
    expect(stopped).not.toBe(false);
    expect(muxStopped).toBe(true);
  }
}

for (const phone of [true, false]) await checkDevice(phone);
