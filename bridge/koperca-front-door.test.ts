import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotCreateStore } from "./bot-create.ts";
import { ActivityLedger } from "./activity.ts";
import { AuditLog } from "./audit.ts";
import { loadConfig } from "./config.ts";
import { createKopercaSso, type SsoRole } from "./koperca-sso.ts";
import { muxOk, type MuxPane, type MuxSpace } from "./mux/types.ts";
import { NotifyPrefsStore } from "./notify-prefs.ts";
import { filePairingIo, PairingStore } from "./pairing.ts";
import { Push } from "./push.ts";
import { startServer } from "./server.ts";
import { SessionRegistry, type SessionParts } from "./sessions.ts";
import { Snooze } from "./snooze.ts";
import type { UpdateMonitor } from "./update.ts";

const site = "https://collie.example.invalid";
const host = new URL(site).host;
const dir = mkdtempSync(join(tmpdir(), "collie-fixture-auth-"));
const cfg = { ...loadConfig({ HOME: dir, COLLIE_STATE_DIR: dir }), host: "127.0.0.1", port: 0, publicHosts: [host] };

// Only the registry, its census and the update badge are needed. No real mux or socket is opened.
function fake<T>(provided: Partial<T>): T {
  // SAFETY: the tests below call only routes whose dependencies are supplied by these fixtures.
  return provided as T;
}
function parts(): SessionParts {
  const panes: MuxPane[] = [];
  const spaces: MuxSpace[] = [];
  return {
    herdr: fake<SessionParts["herdr"]>({
      listSessions: async () => muxOk([]),
      snapshot: async () => ({ spaces: [...spaces], tabs: [], panes: [...panes] }),
      refresh: async () => {},
      createSpace: async ({ label, cwd }) => {
        const spaceId = "fixture-" + String(spaces.length + 1);
        const pane = { spaceId, spaceLabel: label ?? spaceId, paneId: spaceId + "-pane", tabId: spaceId + "-tab", cwd: cwd ?? dir };
        spaces.push(fake<MuxSpace>({ spaceId, label: pane.spaceLabel }));
        panes.push(fake<MuxPane>({ ...pane, terminalId: spaceId + "-terminal" }));
        return muxOk(pane);
      },
    }),
    engine: fake<SessionParts["engine"]>({
      current: () => ({ agents: [], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" }),
      noteAttention() {}, pokeNow() {}, stop() {},
    }),
    poker: fake<SessionParts["poker"]>({ stop() {} }),
    notifications: fake<SessionParts["notifications"]>({ clearAll() {} }),
  };
}

function listen(enabled: boolean) {
  const sso = createKopercaSso({ COLLIE_SSO_ENABLED: enabled ? "1" : "0", COLLIE_SSO_ORIGIN: site }, async (_url, init) => {
    const value = new Headers(init.headers).get("cookie") ?? "";
    const role = value.split("=").at(-1);
    if (!["admin", "member", "viewer"].includes(role ?? "")) return new Response(null, { status: 401 });
    const claims = { sub: role, username: role, roles: [], permissions: ["com.lotto.web.collie:" + role], exp: Date.now() / 1000 + 300 };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return Response.json({ access_token: "fixture." + payload + ".fixture" }, {
      headers: { "Set-Cookie": "plus_session=" + role + "-rotated; Path=/; Domain=.example.invalid; HttpOnly; Secure; SameSite=Lax" },
    });
  });
  return startServer({
    harnesses: { list: async () => [], launch: () => undefined },
    botProfileStore: path => new BotCreateStore(path, name => "/fixture/" + name),
    cfg, sso, legacyOwnerSub: "admin", crew: { mode: "solo", conflict: null, peerServesBrowser: false, trickReads: false },
    registry: new SessionRegistry({ configRoot: dir, primarySocketPath: join(dir, "fixture.sock"), factory: parts, multiSession: false }),
    activity: new ActivityLedger(cfg), audit: new AuditLog(() => undefined), pairing: new PairingStore(filePairingIo(dir)),
    push: new Push(cfg), notifyPrefs: new NotifyPrefsStore(cfg), snooze: new Snooze(cfg), version: "fixture",
    updateMonitor: fake<UpdateMonitor>({ status: () => ({
      current: "fixture", latest: null, latestUrl: null, releaseAvailable: false, majorAvailable: null, majorUrl: null,
      installKind: "binary", dismissedVersion: null, dismissedCrewVersion: null, bridgeStale: false, restartNeeded: false, checkedAt: null,
    }) }),
  });
}

describe("SSO and tenant policy at the bridge's HTTP listener", () => {
  let server: ReturnType<typeof listen>;
  let legacy: ReturnType<typeof listen>;
  const jars = new Map<SsoRole, string>();
  function ask(path: string, role?: SsoRole, init: RequestInit = {}, listener = server) {
    const headers = new Headers(init.headers);
    headers.set("Host", host);
    if (role) headers.set("Cookie", jars.get(role) ?? "");
    return fetch("http://127.0.0.1:" + listener.port + path, { ...init, redirect: "manual", headers });
  }
  beforeAll(async () => {
    server = listen(true);
    legacy = listen(false);
    for (const role of ["admin", "member", "viewer"] as const) {
      const res = await ask("/auth/callback", undefined, { headers: { cookie: "plus_session=" + role } });
      expect(res.status).toBe(303);
      jars.set(role, res.headers.getSetCookie().map(c => c.split(";")[0]).join("; "));
    }
  });
  afterAll(() => {
    void server?.stop(true);
    void legacy?.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("anonymous, paired-device bootstrap, and socket upgrades pass through the same gate", async () => {
    expect((await ask("/")).status).toBe(303);
    for (const path of ["/api/health", "/api/snapshot", "/api/future", "/api/user-settings"]) {
      expect((await ask(path)).status).toBe(401);
    }
    expect((await ask("/api/pair", undefined, { method: "POST", headers: { origin: site } })).status).toBe(401);
    expect((await ask("/ws", "admin", { headers: { upgrade: "websocket", origin: site } })).status).toBe(403);
    expect((await ask("/api/health", undefined, {}, legacy)).status).toBe(200);
    expect((await ask("/api/snapshot", undefined, {}, legacy)).status).toBe(403);
  });

  test("creates through the real workspace handler, replays once and transfers the fixture to a viewer", async () => {
    const post = { method: "POST", headers: { origin: site }, body: JSON.stringify({
      label: "Sample", requestId: "7bafd711-d54c-443c-a922-1f2e4dfab525",
    }) };
    const created = await ask("/api/workspace", "member", post);
    expect(created.status).toBe(200);
    expect((await created.json()).pane.workspaceId).toBe("fixture-1");
    expect((await (await ask("/api/workspace", "member", post)).json()).pane.workspaceId).toBe("fixture-1");
    expect(await (await ask("/api/workspace-owners", "admin")).json()).toEqual([{workspaceId:"fixture-1", sub:"member"}]);
    await ask("/api/user-settings", "viewer");
    const move = { method: "PUT", headers: { origin: site }, body: JSON.stringify({workspaceId:"fixture-1", sub:"viewer"}) };
    expect((await ask("/api/workspace-owners", "member", move)).status).toBe(404);
    expect((await ask("/api/workspace-owners", "admin", move)).status).toBe(200);
    expect((await ask("/api/pane/fixture-1-pane", "member")).status).toBe(404);
  });

  test("launcher defaults follow the signed-in account, including operator edits", async () => {
    const last = { agent: "codexp", effort: "high" };
    const put = { method: "PUT", headers: { origin: site }, body: JSON.stringify(last) };
    expect((await ask("/api/agent-defaults", "member", put)).status).toBe(200);
    expect((await (await ask("/api/agent-defaults?owner=member", "admin")).json()).last).toEqual(last);
    expect((await (await ask("/api/agent-defaults", "admin")).json()).last).toBeNull();
    expect((await (await ask("/api/launchers", "member")).json()).botCreate.last).toEqual(last);
    expect((await (await ask("/api/launchers", "admin")).json()).botCreate.last).toBeNull();
    expect((await ask("/api/agent-defaults?owner=member", "viewer")).status).toBe(404);
    expect((await ask("/api/agent-defaults", "viewer", put)).status).toBe(403);
    expect((await ask("/api/agent-defaults?owner=viewer", "admin", put)).status).toBe(200);
    expect((await (await ask("/api/agent-defaults", "viewer")).json()).last).toEqual(last);
    expect((await ask("/api/agent-defaults", "member", { ...put, body: '{}' })).status).toBe(400);
  });

  test("the listener scopes settings, prevents stale tab writes and enforces read-only access", async () => {
    const patch = { method: "PATCH", headers: { origin: site }, body: JSON.stringify({ set: { language: "es" }, remove: [] }) };
    expect((await ask("/api/user-settings", "member", patch)).status).toBe(200);
    expect((await ask("/api/user-settings", "member", { ...patch, headers: { origin: site, "X-Collie-Subject": "viewer" } })).status).toBe(409);
    expect((await ask("/api/user-settings", "viewer", patch)).status).toBe(403);
    const demoted = await ask("/api/user-settings", "viewer", { headers: { "X-Collie-Role": "admin" } });
    expect(demoted.status).toBe(409);
    expect(demoted.headers.get("X-Collie-Session")).toBe("changed");
    expect((await ask("/api/user-settings?owner=member", "viewer")).status).toBe(404);
    expect(await (await ask("/api/user-settings?owner=member", "admin")).json()).toEqual({ language: "es" });
    expect(await (await ask("/api/user-settings", "viewer")).json()).toEqual({});
    expect((await ask("/api/send", "viewer", { method: "POST", headers: { origin: site }, body: "{}" })).status).toBe(403);
    expect((await ask("/api/refresh", "viewer", { method: "POST", headers: { origin: site } })).status).toBe(200);
    const snap = await ask("/api/snapshot?sessions=all", "viewer");
    expect(snap.status).toBe(200);
    expect(snap.headers.get("cache-control")).toContain("no-store");
    expect((await snap.json()).device).toEqual({ enforced: true, device: "viewer", authorized: false });
  });
});
