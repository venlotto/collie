import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KopercaTenancy } from "./koperca-tenancy.ts";
import type { JsonValue } from "./json.ts";
import type { TenantActor } from "./koperca-tenancy-store.ts";

const owner: TenantActor = { sub: "legacy-fixture", username: "primary", role: "admin" };
const member: TenantActor = { sub: "staff-fixture", username: "operator", role: "member" };
const viewer: TenantActor = { ...member, role: "viewer" };
const other: TenantActor = { sub: "other-fixture", username: "another", role: "member" };
const requestId = "aaaaaaaa-bbbb-cccc-dddd-111111111111";
const row = (spaceId: string) => ({ spaceId, terminalId: "term-" + spaceId, tabId: spaceId + "-tab", paneId: spaceId + "-pane" });
const original = row("existing");
const fresh = row("created");
let state = [original];
let trashBlocked = false;
let activeTrash = false;
let dir: string;
let tenancy: KopercaTenancy;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "collie-tenant-fixture-"));
  tenancy = new KopercaTenancy(dir, owner.sub);
  state = [original];
  trashBlocked = false;
  activeTrash = false;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function snapshot() {
  return {
    bridge: "connected",
    ts: 10,
    secrets: "never",
    servers: [{ id: "external" }],
    agents: state.map((p) => ({
      ...p,
      workspaceId: p.spaceId,
      status: "working",
      usage: "system-wide",
      staleField: "leak",
      held: [{ requestId: "unknown", text: "stale-held" }],
      trash: { trashedAt: 99 },
    })),
    shellPanes: [],
    tabs: state.map((p) => ({ tabId: p.tabId, workspaceId: p.spaceId, paneCount: 90 })),
    workspaces: state.map((p) => ({ workspaceId: p.spaceId, activeTabId: p.tabId })),
    sessions: [{ name: "main", agents: 999, working: 999, reachable: true, isPrimary: true }, { name: "another" }],
  };
}

function call(actor: TenantActor, path: string, method = "GET", body?: JsonValue, next?: (req: Request) => Response | Promise<Response>) {
  const init: RequestInit = { method };
  if (body !== undefined) init.body = JSON.stringify(body);
  const req = new Request("https://fixture.invalid" + path, init);
  return tenancy.handle({
    req,
    pathname: new URL(req.url).pathname,
    actor,
    session: "main",
    topology: async () => ({ spaces: state, panes: state }),
    hasTrashForWorkspace: () => trashBlocked,
    trash: (id) => (activeTrash && id === fresh.terminalId ? { originalWorkspaceId: original.spaceId } : undefined),
    next: async (scoped) => (next ? next(scoped) : Response.json(snapshot())),
  });
}

async function create(actor = member, record?: (req: Request) => Promise<void>) {
  return call(actor, "/api/launch", "POST", { requestId, harness: "codex" }, async (req) => {
    if (record) await record(req);
    if (!state.includes(fresh)) state = [...state, fresh];
    return Response.json({ ok: true, pane: { paneId: fresh.paneId, workspaceId: fresh.spaceId } });
  });
}

describe("Koperca ownership with an isolated mux census", () => {
  test("only the verified replacement for a purged terminal inherits its workspace owner", async () => {
    await create();
    const replacement = { ...fresh, paneId: "retained-pane", terminalId: "retained-terminal" };
    tenancy.retainTab("main", fresh.spaceId, original.terminalId, replacement.terminalId);
    state = [original, replacement];
    expect((await call(member, "/api/pane/retained-pane")).status).toBe(404);
    tenancy.retainTab("main", fresh.spaceId, fresh.terminalId, replacement.terminalId);
    expect((await call(member, "/api/pane/retained-pane")).status).toBe(200);
    expect((await call(other, "/api/pane/retained-pane")).status).toBe(404);
  });

  test("migrates existing panes once to the confirmed subject and reads per user after restart", async () => {
    expect((await (await call(owner, "/api/snapshot")).json()).agents).toHaveLength(1);
    expect((await (await call(member, "/api/snapshot")).json()).agents).toEqual([]);
    expect((await create()).status).toBe(200);
    tenancy = new KopercaTenancy(dir, owner.sub);
    const read = await (await call({ ...member, username: "renamed" }, "/api/snapshot?sessions=all")).json();
    expect(read.agents.map((p: { paneId: string }) => p.paneId)).toEqual([fresh.paneId]);
    expect(read.sessions).toEqual([{ name: "main", reachable: true, isPrimary: true, agents: 1, working: 1, blocked: 0 }]);
    expect(read.workspaces[0].paneCount).toBe(1);
    expect(read.tabs[0].paneCount).toBe(1);
    expect(JSON.stringify(read)).not.toContain(original.spaceId);
    expect(read.servers).toBeUndefined();
    expect(read.agents[0].usage).toBeUndefined();
    expect(read.agents[0].staleField).toBeUndefined();
    expect(JSON.stringify(read)).not.toContain("stale-held");
    expect(read.device.device).toBe("renamed");
    expect(tenancy.ownedSessions(member.sub)).toEqual(["main"]);
    expect(tenancy.ownedSessions(other.sub)).toEqual([]);
    expect((await (await call({ ...owner, role: "viewer" }, "/api/snapshot")).json()).agents[0].paneId).toBe(original.paneId);
    expect(() => new KopercaTenancy(dir, "different-fixture")).toThrow("persisted SSO owner");
  });

  test("viewer can read only their own snapshot and pane and cannot mutate", async () => {
    await create();
    const data = await (await call(viewer, "/api/snapshot")).json();
    expect(data.device.authorized).toBe(false);
    expect(data.agents).toHaveLength(1);
    expect((await call(viewer, "/api/pane/" + fresh.paneId)).status).toBe(200);
    for (const path of ["/api/launch", "/api/send", "/api/bot-action", "/api/chat-order", "/api/user-settings"]) {
      expect((await call(viewer, path, path.endsWith("settings") ? "PATCH" : "POST", {})).status).toBe(403);
    }
  });

  test("denies foreign IDs, alternate host, mixed move, implicit restore and unreviewed routes before dispatch", async () => {
    await create();
    activeTrash = true;
    const cases: [string, string, JsonValue?][] = [
      ["/api/pane/" + original.paneId + "/chat", "GET"],
      ["/api/pane/" + fresh.paneId + "?host=peer", "GET"],
      ["/api/pane/" + original.paneId + "/rename", "POST", { label: "no" }],
      ["/api/send", "POST", { pane: original.paneId }],
      ["/api/tab", "POST", { requestId, workspaceId: original.spaceId }],
      ["/api/bot-action", "POST", { action: "move", terminalId: fresh.terminalId, workspaceId: original.spaceId }],
      ["/api/bot-action", "POST", { action: "restore", terminalId: fresh.terminalId }],
      ["/api/bot-action", "POST", { action: "trashWorkspace", workspaceId: original.spaceId }],
      ["/api/chat-order", "POST", { workspaceId: fresh.spaceId, paneId: fresh.terminalId, before: original.terminalId }],
      ["/api/space/" + fresh.spaceId + "/move", "POST", { before: original.spaceId }],
      ["/api/sent", "GET"],
      ["/api/pane/" + fresh.paneId + "/files", "GET"],
      ["/api/future", "POST", {}],
    ];
    for (const [path, method, body] of cases) {
      const r = await call(member, path, method, body, () => {
        throw new Error("unauthorized dispatch: " + path);
      });
      expect([403, 404]).toContain(r.status);
    }
  });

  test("dispatches the owned UI's chat organization requests", async () => {
    await create();
    const actions: [string, JsonValue][] = [
      ["/api/chat-order", { workspaceId: fresh.spaceId, paneId: fresh.terminalId, before: null }],
      ["/api/bot-action", { action: "trash", terminalId: fresh.terminalId }],
      ["/api/bot-action", { action: "restore", terminalId: fresh.terminalId, workspaceId: fresh.spaceId, trashedAt: 123 }],
      ["/api/bot-action", { action: "trashWorkspace", workspaceId: fresh.spaceId }],
      ["/api/bot-action", { action: "restoreWorkspace", workspaceId: fresh.spaceId, trashedAt: 123 }],
      ["/api/space/" + fresh.spaceId + "/rename", { label: "work" }],
      ["/api/space/" + fresh.spaceId + "/move", { before: null }],
    ];
    for (const [path, body] of actions) {
      expect((await call(member, path, "POST", body, () => Response.json({ ok: true }))).status).toBe(200);
    }
  });

  test("drops recycled or stale pane addresses and foreign order rows", async () => {
    await create();
    const savedSnapshot = snapshot();
    const orders = () =>
      Response.json([
        { workspaceId: fresh.spaceId, paneIds: [fresh.terminalId, original.terminalId] },
        { workspaceId: original.spaceId, paneIds: [original.terminalId] },
      ]);
    expect(await (await call(member, "/api/chat-order", "GET", undefined, orders)).json()).toEqual([
      { workspaceId: fresh.spaceId, paneIds: [fresh.terminalId] },
    ]);
    state = [original, { ...fresh, terminalId: "unregistered-fixture" }];
    expect((await call(member, "/api/pane/" + fresh.paneId)).status).toBe(404);
    expect((await (await call(member, "/api/snapshot", "GET", undefined, () => Response.json(savedSnapshot))).json()).agents).toEqual([]);
  });

  test("namespaces launch and send receipts and rejects a cross-actor retry or resend", async () => {
    let internal: string | undefined;
    const record = async (req: Request) => {
      internal = (await req.json()).requestId;
    };
    await create(member, record);
    const first = internal;
    expect(first).not.toBe(requestId);
    await create(member, record);
    expect(internal).toBe(first);
    const attempt = await create(other, record);
    expect(internal).not.toBe(first);
    expect(attempt.status).toBe(409);
    const send = { pane: fresh.paneId, id: "send-fixture", text: "hello" };
    let id: string | undefined;
    const dispatch = async (req: Request) => {
      id = (await req.json()).id;
      return Response.json({ receipt: { requestId: id, outcome: "sent" }, offers: [] });
    };
    const receipt = await call(member, "/api/send", "POST", send, dispatch);
    expect(id).not.toBe(send.id);
    expect((await receipt.json()).receipt.requestId).toBe(send.id);
    const retry = await call(member, "/api/send", "POST", send, dispatch);
    expect((await retry.json()).receipt.requestId).toBe(send.id);
    const cancel = await call(member, "/api/send/" + send.id + "?pane=" + fresh.paneId, "DELETE", undefined, (req) =>
      Response.json({ target: new URL(req.url).pathname }),
    );
    expect((await cancel.json()).target).toBe("/api/send/" + id);
    expect((await call(other, "/api/send/" + send.id + "?pane=" + fresh.paneId, "DELETE")).status).toBe(404);
    const list = await call(member, "/api/send/receipts?pane=" + fresh.paneId, "GET", undefined, () =>
      Response.json({
        receipts: [
          { requestId: id, text: "my message" },
          { requestId: "unowned-fixture", text: "another terminal" },
        ],
      }),
    );
    expect((await list.json()).receipts).toEqual([{ requestId: send.id, text: "my message" }]);
    expect((await call(member, "/api/send", "POST", { ...send, resendOf: "foreign-id" })).status).toBe(404);
    expect((await call(member, "/api/send", "POST", { ...send, id: "second-id", resendOf: send.id })).status).toBe(200);
  });

  test("admin assigns a whole workspace to a viewer and can recover an orphan without touching the mux", async () => {
    await create();
    const assignedViewer: TenantActor = { ...other, role: "viewer" };
    const transfer = { workspaceId: fresh.spaceId, sub: assignedViewer.sub };
    expect((await call(owner, "/api/workspace-owners", "PUT", transfer)).status).toBe(404);
    await call(assignedViewer, "/api/user-settings");
    expect((await call(member, "/api/workspace-owners", "PUT", transfer)).status).toBe(404);
    trashBlocked = true;
    expect((await call(owner, "/api/workspace-owners", "PUT", transfer)).status).toBe(409);
    trashBlocked = false;
    activeTrash = true;
    expect((await call(owner, "/api/workspace-owners", "PUT", transfer)).status).toBe(409);
    activeTrash = false;
    expect((await call(owner, "/api/workspace-owners", "PUT", transfer)).status).toBe(200);
    expect((await call(member, "/api/pane/" + fresh.paneId)).status).toBe(404);
    expect((await call(assignedViewer, "/api/pane/" + fresh.paneId)).status).toBe(200);
    expect((await call(assignedViewer, "/api/pane/" + fresh.paneId + "/rename", "POST", { label: "no" })).status).toBe(403);
    const detached = row("orphan");
    state.push(detached);
    expect((await call(member, "/api/pane/" + detached.paneId)).status).toBe(404);
    expect((await call(owner, "/api/workspace-owners", "PUT", { workspaceId: detached.spaceId, sub: member.sub })).status).toBe(200);
    expect((await call(member, "/api/pane/" + detached.paneId)).status).toBe(200);
  });

  test("withholds a pane read if an admin reassigns it during asynchronous dispatch", async () => {
    await create();
    await call(other, "/api/user-settings");
    const waiting = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const response = call(member, "/api/pane/" + fresh.paneId + "/chat", "GET", undefined, async () => {
      waiting.resolve();
      await release.promise;
      return Response.json({ text: "private" });
    });
    await waiting.promise;
    expect((await call(owner, "/api/workspace-owners", "PUT", { workspaceId: fresh.spaceId, sub: other.sub })).status).toBe(200);
    release.resolve();
    expect((await response).status).toBe(404);
  });

  test("patches preferences per subject with admin lookup and rejects viewer and foreign writes", async () => {
    const save = { set: { theme: "dark", density: "high" }, remove: [] };
    expect((await call(member, "/api/user-settings", "PATCH", save)).status).toBe(200);
    expect((await call(member, "/api/user-settings", "PATCH", { set: { theme: "blue" }, remove: ["density"] })).status).toBe(200);
    expect(await (await call(other, "/api/user-settings")).json()).toEqual({});
    expect(await (await call(owner, "/api/user-settings?owner=" + member.sub)).json()).toEqual({ theme: "blue" });
    expect((await call(other, "/api/user-settings?owner=" + member.sub, "PATCH", save)).status).toBe(404);
    expect((await call(member, "/api/user-settings/owners")).status).toBe(404);
    expect(tenancy.preferencesDir(owner.sub)).toBe(dir);
    expect(tenancy.preferencesDir(member.sub)).not.toBe(tenancy.preferencesDir(other.sub));
  });
});
