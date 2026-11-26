// A real bridge and a private Herdr socket. No agents or remote APIs are started.
import { chromium, webkit, devices, expect } from "@playwright/test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ScratchBridge } from "../../../scripts/harness-canary/lab/phone-bridge.ts";

const root = mkdtempSync(join(tmpdir(), "collie-run-e2e-"));
const home = join(root, "home"), cwd = join(root, "informe"), config = join(home, ".codex");
const herdr = Bun.which("herdr");
const socket = join(home, ".config/herdr/herdr.sock");
const env = { HOME: home, HERDR_SOCKET_PATH: socket, PATH: dirname(herdr) + ":/usr/bin:/bin", TERM: "xterm-256color", SHELL: "/bin/bash" };
const pictures = process.env.BOT_SCREENSHOTS;
const sid = "11111111-2222-4444-8888-999999999999";
const id = "20261126T030000-informe-abcd";
const day = join(config, "sessions", new Date().toISOString().slice(0, 10).replaceAll("-", "/"));
const journal = join(day, "rollout-fixture-" + sid + ".jsonl");
function turn(role, text) {
  return JSON.stringify({ timestamp: new Date().toISOString(), type: "response_item", payload: {
    type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] } }) + "\n";
}
let bridge, server;
function rpc(...args) {
  const reply = Bun.spawnSync([herdr, ...args], { cwd, env, stderr: "ignore" });
  if (reply.exitCode !== 0) throw new Error("Private Herdr failed: " + args.slice(0, 2).join(" "));
  return reply.stdout.toString();
}
async function check(phone, pane, dir) {
  const browser = await (phone ? webkit : chromium).launch();
  const prefix = phone ? "iphone-webkit" : "desktop";
  try {
    const page = await browser.newPage({ ...(phone ? devices["iPhone 13"] : devices["Desktop Chrome"]),
      viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, serviceWorkers: "block",
      storageState: { cookies: [], origins: [{ origin: bridge.url, localStorage: [
        { name: "collie:device-token", value: bridge.token }, { name: "collie:locale:v1", value: "es" }] }] } });
    const status = { id, created_at: new Date(Date.now() - 205000).toISOString(),
      name: "Informe de salas", agent: "codexp", cwd, status: "running", herdr_pane: null };
    const publish = row => writeFileSync(join(dir, row.id + ".status"), JSON.stringify(row));
    publish(status);
    publish({ ...status, id: "20261126T030000-balance-abcd", name: "Balance diario", cwd: join(root, "other"), status: "done", ended_at: new Date().toISOString() });
    writeFileSync(join(dir, "20261126T030000-balance-abcd.log"), "Balance de la tarde confirmado.");
    writeFileSync(join(dir, id + ".log"), "session id: " + sid + "\nuser\n");
    const activity = [
      { type: "function_call", name: "exec_command", call_id: "test", arguments: JSON.stringify({ cmd: "wc -l salas.csv" }) },
      { type: "function_call_output", call_id: "test", output: JSON.stringify({ output: "4 salas.csv", metadata: { exit_code: 0 } }) },
    ].map(payload => JSON.stringify({ timestamp: new Date().toISOString(), type: "response_item", payload }) + "\n").join("");
    writeFileSync(journal, turn("user", "¿Puedes revisar el resumen de las salas?") + activity + turn("assistant", "Ya revisé las salas de la mañana. Estoy comprobando los totales de la tarde."));
    let stopped = 0;
    await page.route(url => url.pathname.endsWith("/stop-run"), route => {
      if (route.request().method() === "POST" && decodeURIComponent(new URL(route.request().url()).pathname).includes("agent-run:" + id + "/")) stopped++;
      publish({ ...status, status: "failed", ended_at: new Date().toISOString() });
      return route.fulfill({ json: { ok: true } });
    });
    const shot = async label => {
      if (pictures) await page.screenshot({ path: join(pictures, prefix + "-" + label + ".png"), scale: "css", animations: "disabled" });
    };
    await page.goto(bridge.url);
    const row = page.locator(".bot-row").filter({ hasText: "Informe de salas" });
    await expect(row).toContainText("Trabajando…", { timeout: 45000 });
    await expect(page.locator(".bot-row").filter({ hasText: "Balance diario" })).toContainText("Listo");
    await shot("list");
    const listNode = await page.locator(".bot-scroll").elementHandle();
    await row.click();
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(pane)), { timeout: 15000 });
    await expect(page.getByText("¿Puedes revisar el resumen de las salas?", { exact: true })).toBeVisible({ timeout: 40000 });
    const progress = "Comprobé los totales. Las cuatro salas coinciden.";
    appendFileSync(journal, turn("assistant", progress));
    await expect(page.getByText(progress, { exact: false }).last()).toBeVisible({ timeout: 45000 });
    await expect(page.locator(".bot-activity button").first()).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("wc -l salas.csv", { exact: true })).toHaveCount(0);
    expect(await listNode.evaluate(node => node === document.querySelector(".bot-scroll"))).toBe(true);
    await shot("chat");
    await page.reload(); // cold link to the original empty shell, with no SessionStart.
    await expect(page.getByText(progress, { exact: false }).last()).toBeVisible({ timeout: 40000 });
    const statusBar = page.locator(".agent-run-status");
    const statusEdges = () => statusBar.evaluate(node => {
      const { top, bottom } = node.getBoundingClientRect();
      return [top, bottom];
    });
    const runningEdges = await statusEdges();
    await page.getByRole("button", { name: "Detener", exact: true }).click();
    await expect.poll(() => stopped).toBe(1);
    await expect(page.locator(".agent-run-status")).toContainText("Falló", { timeout: 45000 });
    expect(await statusEdges()).toEqual(runningEdges);
    await shot("failed");
    await page.getByRole("button", { name: "Volver a los chats" }).click();
    await page.locator(".bot-row").filter({ hasText: "Balance diario" }).click();
    await expect(page.locator(".bot-detail").getByText("Balance de la tarde confirmado.", { exact: true })).toBeVisible({ timeout: 40000 });
    await page.getByRole("button", { name: "Volver a los chats" }).click();
    const balance = page.locator(".bot-row").filter({ hasText: "Balance diario" });
    await expect(balance).toContainText("Balance de la tarde confirmado.", { timeout: 40000 });
    await expect(balance.locator(".bot-activity-avatar")).toHaveAttribute("data-activity", "idle");
  } finally { await browser.close(); }
}
// The terminal screenshot uses the actual Herdr pane. Put this run in a
// separate temporary runs directory so Collie opens its ordinary terminal view.
async function checkLaunchPane() {
  const bin = process.env.AGENT_RUN_FIXTURE_BIN;
  if (!bin) return;
  const work = join(root, "visor");
  mkdirSync(work);
  const pane = JSON.parse(rpc("workspace", "create", "--cwd", work, "--label", "Visor de prueba", "--no-focus")).result.root_pane.pane_id;
  const runner = join(bin, "agent-run"), tempRuns = join(root, "viewer-runs");
  const probe = join(work, "probe");
  writeFileSync(probe, "#!/bin/bash\necho 'Visor de prueba: procesando el informe.'\necho 'Verificación de salas completada.'\nwhile [[ ! -f finish ]]; do sleep 0.2; done\n", { mode: 0o700 });
  const prompt = join(work, "prompt");
  writeFileSync(prompt, "Prueba");
  const fixtureEnv = { ...env, AGENT_RUN_TEST: "1", AGENT_RUN_ENV_FILES: "", XDG_RUNTIME_DIR: "/run/user/" + process.getuid(),
    AGENT_RUN_CENTRAL_NOTIFIER: join(bin, "../tests/fake-central-notifier.sh") };
  const launched = Bun.spawnSync([runner, "--pane", pane, "--bot", "prueba", "--timeout", "120s", "--no-notify",
    "--runs-dir", tempRuns, "--name", "visor-prueba", probe, prompt, work], { env: fixtureEnv });
  if (launched.exitCode !== 0) throw new Error("Fixture agent-run did not launch");
  const runId = launched.stdout.toString().trim();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block",
      storageState: { cookies: [], origins: [{ origin: bridge.url, localStorage: [
        { name: "collie:device-token", value: bridge.token }, { name: "collie:locale:v1", value: "es" }] }] } });
    await expect.poll(() => rpc("pane", "read", pane, "--source", "visible", "--raw")).toContain("procesando el informe.");
    await page.goto(bridge.url + "/pane/" + encodeURIComponent(pane));
    await expect(page.locator(".bot-terminal")).toContainText("procesando el informe.", { timeout: 35000 });
    if (pictures) await page.screenshot({ path: join(pictures, "nuevo-pane-log.png"), scale: "css" });
    rpc("workspace", "close", pane.split(":")[0]);
  } finally {
    writeFileSync(join(work, "finish"), "ok");
    await browser.close();
  }
  const waited = Bun.spawnSync([join(bin, "agent-wait"), runId, "--runs-dir", tempRuns, "--quiet", "--timeout", "30s", "--interval", "1"], { env: fixtureEnv });
  if (waited.exitCode !== 0) throw new Error("Fixture run did not survive closing the viewer");
}

try {
  for (const path of [cwd, day, dirname(socket)]) mkdirSync(path, { recursive: true, mode: 0o700 });
  if (pictures) mkdirSync(pictures, { recursive: true });
  server = Bun.spawn([herdr, "server"], { cwd, env, stdout: "ignore", stderr: "ignore" });
  await expect.poll(() => existsSync(socket), { timeout: 15000 }).toBe(true);
  const pane = JSON.parse(rpc("workspace", "create", "--cwd", cwd, "--label", "Sala de operaciones", "--no-focus")).result.root_pane.pane_id;
  bridge = await ScratchBridge.start({ repoRoot: join(import.meta.dirname, "../../.."), root: join(root, "bridge"),
    herdrSocket: socket, codexHome: config, agentBinDir: dirname(herdr), agentConfig: config, env }, () => {});
  const dir = join(bridge.xdgState, "agent-runs");
  mkdirSync(dir, { recursive: true });
  for (const phone of [true, false]) await check(phone, pane, dir);
  await checkLaunchPane();
  console.log("PASS private pane binding, journal append, direct link and mock stop on iPhone WebKit and desktop");
} finally {
  if (bridge) await bridge.stop();
  if (server) {
    if (existsSync(socket)) rpc("server", "stop");
    if (await Promise.race([server.exited, Bun.sleep(2000).then(() => null)]) === null) server.kill();
    await server.exited;
  }
  rmSync(root, { recursive: true, force: true });
}
