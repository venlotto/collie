// Run after `cd web && bun run build`: BOT_SCREENSHOTS=<directory> bun web/e2e/manual/bot-send-claude-long.mjs
// A private Herdr server (its own HOME and socket) runs the installed Claude Code in its default headless
// pane, 54 x 23, the size of the live report of 2026-11-27, with the operator's fullscreen renderer.
// Claude's model calls go to a local Anthropic stand-in that records the text of each turn and answers "OK":
// no login is read and no model turn is spent. The phone (WebKit, iPhone 390 x 844) and the desktop
// (Chromium, 1280 x 800) each send the 376-character line of the live receipts three times in a row, a "?" and a
// Replace over a planted draft, and every one must start a turn whole. LP_DEBUG=1 prints the long send's receipt and screen.
import { chromium, devices, expect, webkit } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ScratchBridge } from "../../../scripts/harness-canary/lab/phone-bridge.ts";
import { seedClaudeReplay } from "../../../scripts/harness-canary/lab/seed.ts";

const repo = join(import.meta.dirname, "../../..");
const pictures = process.env.BOT_SCREENSHOTS;
const herdr = Bun.which("herdr");
const claudeOnPath = Bun.which("claude");
if (!herdr || !claudeOnPath) throw new Error("This test needs Herdr and Claude Code 2.1.332");
const claude = claudeOnPath;
const root = mkdtempSync(join(tmpdir(), "collie-claude-long-"));
const home = join(root, "home");
const cwd = join(root, "project");
const config = join(home, ".claude");
const socket = join(home, ".config/herdr/herdr.sock");
const SENTENCE = "Por favor responde solo OK y para. Esta es una frase un poco larga para probar el ajuste de linea en un pane estrecho de Claude.";
const LONG = [SENTENCE, SENTENCE, SENTENCE].join(" ").slice(0, 376);
const turns = [];

// The Anthropic stand-in: the reachability check passes, a message call records its last user text and
// answers "OK" (streamed or not), anything else is a 503 that never leaves the machine.
const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  const path = new URL(req.url).pathname;
  if (path.endsWith("/api/hello")) return new Response(null, { status: 200 });
  if (!path.endsWith("/v1/messages") || req.method !== "POST") return new Response(null, { status: 503 });
  const body = await req.json();
  const user = body.messages?.findLast(m => m.role === "user")?.content;
  // The Messages API carries a user turn as a string or as content blocks.
  const texts = Array.isArray(user) ? user.filter(b => b.type === "text").map(b => b.text) : [String(user ?? "")];
  turns.push(texts.join("\n"));
  const message = { id: "msg_lab", type: "message", role: "assistant", model: body.model ?? "claude-lab", content: [{ type: "text", text: "OK" }],
    stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  if (body.stream !== true) return Response.json(message);
  const events = [
    ["message_start", { type: "message_start", message: { ...message, content: [], stop_reason: null } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return new Response(events.map(([e, d]) => "event: " + e + "\ndata: " + JSON.stringify(d) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
} });

const env = { HOME: home, HERDR_SOCKET_PATH: socket, CLAUDE_CONFIG_DIR: config, ANTHROPIC_BASE_URL: "http://127.0.0.1:" + model.port,
  TERM: "xterm-256color", LANG: "C.UTF-8", SHELL: "/bin/bash", PATH: [dirname(claude), dirname(herdr), "/usr/bin", "/bin"].join(":") };

function rpc(...args) {
  const result = Bun.spawnSync([herdr, ...args], { cwd, env, stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error("Private Herdr command failed: " + args.slice(0, 2).join(" "));
  return result.stdout.toString();
}

// The read carries SGR only; this strips it.
const SGR = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "gu");
/** The pane's visible rows as plain text. */
const plain = pane => rpc("pane", "read", pane, "--source", "visible", "--raw").replace(SGR, "");

/** Whether a turn started with exactly this text (Claude trims the end of a prompt). */
const turnOf = text => turns.some(t => t.trim() === text.trim() || t.includes(text.trim()));

async function checkBrowser(phone, bridge, pane) {
  const device = phone ? "iphone" : "desktop";
  const browser = await (phone ? webkit : chromium).launch();
  const log = [];
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
    await expect(page.locator(".bot-row")).toHaveCount(1, { timeout: 20000 });
    await page.locator(".bot-row").click();
    const box = page.locator('[data-slot="composer-box"]');
    const field = box.locator("textarea").first();
    const send = box.locator('[data-slot="composer-primary"]');
    const submit = () => phone ? send.tap() : field.press("Enter");
    const response = () => page.waitForResponse(r => new URL(r.url()).pathname === "/api/send" && r.request().method() === "POST", { timeout: 30000 });
    // Claude idle again: its box is drawn and no turn is running (an answer of "OK" takes a moment to draw).
    const idle = () => expect.poll(() => { const s = plain(pane); return s.includes("❯") && !/esc to interrupt/u.test(s); }, { timeout: 20000 }).toBe(true);
    await expect(field).toBeInViewport();

    // 1. The live receipts' line, three times in a row: each is sent whole, Enter pressed, and the turn starts
    // with all 376 characters. From the second on, the first turn's echo (`❯` and its wrapped rows) stands over
    // the scrolled box, which once read as a dialog: typed_not_submitted (modal_cue), live 2026-11-27.
    for (let n = 1; n <= 3; n++) {
      await idle();
      const before = turns.length;
      await field.fill(LONG);
      const delivery = response();
      await submit();
      const answer = await (await delivery).json();
      const { receipt } = answer;
      log.push(["largo-" + n, receipt.outcome, receipt.reason ?? null]);
      if (process.env.LP_DEBUG) console.log(device, "largo-" + n, JSON.stringify({ receipt, detail: answer.detail, cause: answer.cause }), "\n" + plain(pane));
      expect(receipt).toMatchObject({ outcome: "sent", profileId: "claude", version: "2.1.332" });
      expect(receipt.keys.at(-1)).toBe("Enter");
      // A later turn's user message carries the earlier ones too: the newest text is what this send started.
      await expect.poll(() => turns.length > before && turns.at(-1).trim().endsWith(LONG.trim()), { timeout: 20000 }).toBe(true);
      await expect(field).toHaveValue("");
      await shot("01-largo-" + n + "-enviado");
    }
    let delivery;
    let receipt;

    // 2. A "?" right after: literal text, no shortcut overlay, sent.
    await idle();
    await field.fill("?");
    delivery = response();
    await submit();
    ({ receipt } = await (await delivery).json());
    log.push(["?", receipt.outcome, receipt.reason ?? null]);
    expect(receipt).toMatchObject({ outcome: "sent" });
    await expect.poll(() => turnOf("?"), { timeout: 20000 }).toBe(true);
    await shot("02-interrogacion");

    // 3. A draft planted at the desk, then the long line: refused over the draft, and Replace sends it whole.
    await idle();
    const draft = "borrador local " + device;
    rpc("pane", "send-text", pane, draft);
    await expect.poll(() => rpc("pane", "read", pane, "--source", "visible", "--raw"), { timeout: 10000 }).toContain(draft);
    const before = turns.length;
    await field.fill(LONG);
    delivery = response();
    await submit();
    const refused = await (await delivery).json();
    log.push(["sobre-borrador", refused.receipt.outcome, refused.receipt.reason ?? null]);
    expect(refused.receipt).toMatchObject({ outcome: "refused", reason: "draft_present" });
    const sheet = page.getByRole("dialog", { name: "El cuadro ya contiene un borrador" });
    await expect(sheet).toBeInViewport();
    await shot("03-borrador");
    delivery = response();
    await sheet.getByRole("button", { name: "Reemplazar" }).click();
    ({ receipt } = await (await delivery).json());
    log.push(["reemplazar", receipt.outcome, receipt.reason ?? null]);
    expect(receipt).toMatchObject({ outcome: "sent" });
    await expect.poll(() => turns.slice(before).some(t => t.trim() === LONG.trim()), { timeout: 20000 }).toBe(true);
    expect(turns.some(t => t.includes(draft))).toBe(false);
    await shot("04-reemplazado");

    // 4. And the next plain send still works.
    await idle();
    await field.fill("responde OK y para");
    delivery = response();
    await submit();
    ({ receipt } = await (await delivery).json());
    log.push(["siguiente", receipt.outcome, receipt.reason ?? null]);
    expect(receipt).toMatchObject({ outcome: "sent" });
    await expect.poll(() => turnOf("responde OK y para"), { timeout: 20000 }).toBe(true);
    await shot("05-siguiente");
    console.log(device, JSON.stringify(log));
  } finally {
    await browser.close();
  }
}

let server, bridge, workspace;
try {
  for (const dir of [config, cwd, dirname(socket)]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  // A dummy login and this project trusted. No real credential or state file is read.
  seedClaudeReplay(config, cwd, { configDir: join(root, "none"), stateFile: join(root, "none.json") });
  // The live operator's renderer: with it Claude caps its box (six rows here) and scrolls a long draft under
  // `↑ N more`; the default renderer grows the box instead, and the regression does not show.
  writeFileSync(join(config, "settings.json"), JSON.stringify({ tui: "fullscreen", theme: "dark" }));
  server = Bun.spawn([herdr, "server"], { cwd, env, stdout: "ignore", stderr: "ignore" });
  await expect.poll(() => existsSync(socket)).toBe(true);
  const created = JSON.parse(rpc("workspace", "create", "--cwd", cwd, "--label", "Prueba texto largo", "--no-focus")).result;
  workspace = created.workspace.workspace_id;
  const pane = created.root_pane.pane_id;
  const rect = JSON.parse(rpc("pane", "layout", "--pane", pane)).result.layout.panes[0].rect;
  console.log("pane", pane, rect.width + "x" + rect.height);
  // Started by its own name: Herdr names the pane's agent from the foreground process.
  rpc("pane", "run", pane, "exec claude --effort low");
  const screen = () => rpc("pane", "read", pane, "--source", "visible", "--raw");
  await expect.poll(screen, { timeout: 30000 }).toContain("v2.1.332");
  await expect.poll(() => plain(pane), { timeout: 30000 }).toContain("❯");
  bridge = await ScratchBridge.start({ repoRoot: repo, root: join(root, "bridge"), herdrSocket: socket, codexHome: join(root, "codex"),
    agentBinDir: dirname(claude), agentConfig: config, env }, () => {});
  for (const phone of [true, false]) await checkBrowser(phone, bridge, pane);
  console.log("turns", turns.length);
} finally {
  await bridge?.stop();
  if (server && server.exitCode === null) {
    try {
      if (workspace) rpc("workspace", "close", workspace);
      rpc("server", "stop");
    } catch {
      server.kill();
    }
  }
  model.stop(true);
  rmSync(root, { recursive: true, force: true });
}
