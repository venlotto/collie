// Run after bun run build. All sockets, pairing and Codex state belong to this run.
import { chromium, devices, expect, webkit } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ScratchBridge } from "../../../scripts/harness-canary/lab/phone-bridge.ts";

const repo = join(import.meta.dirname, "../../..");
const pictures = process.env.BOT_SCREENSHOTS;
const herdr = Bun.which("herdr");
const codexp = Bun.which("codexp");
if (!herdr || !codexp) throw new Error("This test needs Herdr and codexp 0.172.0");
const root = mkdtempSync(join(tmpdir(), "collie-herdr-"));
const home = join(root, "home");
const cwd = join(root, "project");
const config = join(home, ".codex");
const socket = join(home, ".config/herdr/herdr.sock");
const env = { HOME: home, CODEX_HOME: config, HERDR_SOCKET_PATH: socket, TERM: "xterm-256color", LANG: "C.UTF-8",
  SHELL: "/bin/bash", PATH: [dirname(codexp), dirname(herdr), "/usr/bin", "/bin"].join(":") };
const messages = [];

// A local Responses endpoint witnesses the text that actually started a new Codex turn.
const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  if (!new URL(req.url).pathname.endsWith("/responses")) return new Response(null, { status: 404 });
  const body = await req.json();
  const turn = body.input?.findLast(item => item.role === "user")?.content;
  for (const item of turn ?? []) if (item.type === "input_text") messages.push(item.text);
  const msg = { id: "msg_lab", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Recibido." }] };
  const response = { id: "resp_lab", object: "response", model: "gpt-5", status: "completed", output: [msg] };
  const events = [
    { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...msg, content: [] } },
    { type: "response.output_text.delta", item_id: msg.id, output_index: 0, content_index: 0, delta: "Recibido." },
    { type: "response.output_item.done", output_index: 0, item: msg },
    { type: "response.completed", response },
  ];
  return new Response(events.map(e => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
} });

function rpc(...args) {
  const result = Bun.spawnSync([herdr, ...args], { cwd, env, stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error("Private Herdr command failed: " + args.slice(0, 2).join(" "));
  return result.stdout.toString();
}

async function checkBrowser(phone, bridge, pane) {
  const device = phone ? "iphone-webkit" : "desktop";
  const text = "Prueba de entrega " + device;
  const browser = await (phone ? webkit : chromium).launch();
  try {
    const page = await browser.newPage({ ...(phone ? devices["iPhone 13"] : devices["Desktop Chrome"]),
      viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, serviceWorkers: "block",
      storageState: { cookies: [], origins: [{ origin: bridge.url, localStorage: [
        { name: "collie:device-token", value: bridge.token }, { name: "collie:locale:v1", value: "es" },
      ] }] } });
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
    const send = box.locator('[data-slot="composer-primary"]');
    const submit = () => phone ? send.tap() : field.press("Enter");
    const response = () => page.waitForResponse(r => new URL(r.url()).pathname === "/api/send" && r.request().method() === "POST");
    await expect(field).toBeInViewport();
    const bottom = () => box.evaluate(el => el.getBoundingClientRect().bottom);
    const before = await bottom();
    await field.fill(text);
    const after = await bottom();
    expect(Math.abs(after - before)).toBeLessThan(0.51);
    const delivery = response();
    await submit();
    const { receipt } = await (await delivery).json();
    expect(receipt).toMatchObject({ outcome: "sent", profileId: "codex", version: "0.172.0", keys: ["probe", "Backspace", "Enter"] });
    await expect.poll(() => messages.filter(m => m === text).length).toBe(1);
    await expect(field).toHaveValue("");
    await expect(page.locator(".bot-detail")).toContainText(text);
    // Reload discards the in-memory optimistic row. Only a fresh terminal/journal read can pass.
    await page.reload();
    await expect(page.locator(".bot-row").first().or(field).first()).toBeAttached();
    if (!(await field.isVisible())) await page.locator(".bot-row").click();
    await expect(page.locator('[data-slot="stream-pending"],[data-slot="mirror-pending"]')).toHaveCount(0);
    await expect(page.locator(".bot-detail")).toContainText(text);
    await shot("enviado");

    // Plant a real unrelated terminal draft. The bridge must return a specific refusal and leave it there.
    const draft = "borrador local";
    rpc("pane", "send-text", pane, draft);
    const rejected = "Pendiente " + device;
    await field.fill(rejected);
    const rejection = response();
    await submit();
    const refused = await (await rejection).json();
    expect(refused.receipt).toMatchObject({ outcome: "refused", reason: "draft_present" });
    await expect(field).toHaveValue(rejected);
    const warning = page.getByRole("dialog", { name: "El cuadro ya contiene un borrador" });
    await expect(warning).toBeInViewport();
    await expect(warning).toContainText(draft);
    expect(messages).not.toContain(rejected);
    expect(rpc("pane", "read", pane, "--source", "visible", "--raw")).toContain(draft);
    await shot("borrador");
    await warning.getByRole("button", { name: "Cancelar" }).click();
    console.log(device, receipt.outcome, receipt.keys, refused.receipt.reason, "composer delta", after - before);
    // Only the lab's pane, after proving its own draft remains.
    for (const _ of draft) rpc("pane", "send-keys", pane, "Backspace");
  } finally {
    await browser.close();
  }
}

let server, bridge, workspace;
try {
  for (const dir of [config, cwd, dirname(socket)]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(config, "config.toml"), [
    'model_provider = "lab"', 'model = "gpt-5"', '[model_providers.lab]', 'name = "Local fixture"',
    'base_url = "http://127.0.0.1:' + model.port + '/v1"', 'wire_api = "responses"',
    '[features]', 'daemon_auto_start = false',
    '[projects.' + JSON.stringify(cwd) + ']', 'trust_level = "trusted"',
  ].join("\n"));
  server = Bun.spawn([herdr, "server"], { cwd, env, stdout: "ignore", stderr: "ignore" });
  await expect.poll(() => existsSync(socket)).toBe(true);
  const created = JSON.parse(rpc("workspace", "create", "--cwd", cwd, "--label", "Prueba de envío", "--no-focus")).result;
  workspace = created.workspace.workspace_id;
  const pane = created.root_pane.pane_id;
  rpc("pane", "run", pane, "exec", "codexp", "Inicio");
  const screen = () => rpc("pane", "read", pane, "--source", "visible", "--raw");
  await expect.poll(screen, { timeout: 20000 }).toContain("v0.172.0");
  // The agents hint appears on an established chat, after its first turn.
  await expect.poll(() => messages, { timeout: 90000 }).toContain("Inicio");
  await expect.poll(screen).toContain("Recibido.");
  // A fresh Herdr has no host integration hooks. Bind only the rollout this private Codex wrote.
  const rollouts = [...new Bun.Glob("**/rollout-*.jsonl").scanSync({ cwd: join(config, "sessions"), absolute: true })];
  expect(rollouts).toHaveLength(1);
  const session = JSON.parse((await Bun.file(rollouts[0]).text()).split("\n", 1)[0]).payload.id;
  rpc("pane", "report-agent", pane, "--source", "herdr:codex", "--agent", "codex", "--state", "idle", "--agent-session-id", session);
  expect(JSON.parse(rpc("pane", "get", pane)).result.pane.agent_session?.value).toBe(session);
  bridge = await ScratchBridge.start({ repoRoot: repo, root: join(root, "bridge"), herdrSocket: socket, codexHome: config,
    agentBinDir: dirname(codexp), agentConfig: config, env }, () => {});
  for (const phone of [true, false]) await checkBrowser(phone, bridge, pane);
} finally {
  await bridge?.stop();
  if (server && server.exitCode === null) {
    try {
      if (workspace) rpc("workspace", "close", workspace);
      rpc("server", "stop");
    } finally {
      if (await Promise.race([server.exited, Bun.sleep(2000).then(() => null)]) === null) server.kill();
      await server.exited;
    }
  }
  Bun.spawnSync(["codex", "app-server", "daemon", "stop"], { env, cwd, stdout: "ignore", stderr: "ignore" });
  model.stop(true);
  rmSync(root, { recursive: true, force: true });
}
