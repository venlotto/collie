// All browser API routes pass here while Koperca SSO is active. Members get only
// audited, local operations. A new upstream route is administrator-only by default.
import { createHash } from "node:crypto";
import { asJsonString, asJsonObject, parseJson, parseJsonObject, type JsonObject, type JsonValue } from "../web/src/lib/json.ts";
import { OwnerStore, type TenantActor, type TenantTopology } from "./koperca-tenancy-store.ts";
import { REQUEST_ID } from "../web/src/lib/surface/send.ts";
import { isRequestId } from "./worktree-receipts.ts";

import type { BotCreateStore } from "./bot-create.ts";

interface Call {
  profileStore?: (dir: string) => BotCreateStore;
  actor: TenantActor;
  session: string;
  req: Request;
  pathname: string;
  topology(): Promise<TenantTopology>;
  trash?(terminalId: string): { originalWorkspaceId: string; workspaceLabel?: string } | undefined;
  hasTrashForWorkspace?(workspaceId: string): boolean;
  active?(): boolean;
  next(request: Request): Promise<Response>;
}

const forbidden = () => new Response("Forbidden", { status: 403 });
const hidden = () => new Response("Not found", { status: 404 });
const expired = () => new Response("Sesión caducada", { status: 401 });
const bad = () => new Response("Invalid request", { status: 400 });
const conflict = () => new Response("Resource changed", { status: 409 });
const json = <T>(body: T) => Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
const validSettingName = (key: string) => key.length > 0 && key.length <= 256 && !["__proto__", "prototype", "constructor"].includes(key);
const panePath = /^\/api\/pane\/([^/]+)(?:\/(chat|history|rename|reply|keys|upload|arrived|close))?$/;
const cancelPath = /^\/api\/send\/([A-Za-z0-9_-]{8,64})$/;
const spacePath = /^\/api\/space\/([^/]+)\/(move|rename)$/;
const scopedRoutes = new Set([
  "/api/snapshot",
  "/api/launch",
  "/api/tab",
  "/api/workspace",
  "/api/send",
  "/api/send/receipts",
  "/api/chat-order",
  "/api/bot-action",
  "/api/workspace-owners",
]);
const objects = (value: JsonValue | undefined) =>
  Array.isArray(value) ? value.map(asJsonObject).filter((item): item is JsonObject => item !== undefined) : [];

// Only fields describing this exact terminal belong in the restricted wire view.
// Host aggregates, hook caches and receipt books keyed only by pane address stay private.
const paneFields = [
  "terminalId",
  "paneId",
  "workspaceId",
  "workspaceLabel",
  "workspaceNumber",
  "workspaceNamed",
  "tabId",
  "tabLabel",
  "tabPosition",
  "agent",
  "kind",
  "status",
  "cwd",
  "focused",
  "paneLabel",
  "sessionName",
  "session",
  "terminalTitle",
  "hasSession",
  "readableLines",
  "sendProtocol",
];

function pick(row: JsonObject, names: readonly string[]): JsonObject {
  return Object.fromEntries(names.filter((name) => row[name] !== undefined).map((name) => [name, row[name]]));
}

function decode(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

function plainRequest(req: Request, body?: JsonObject) {
  const headers = new Headers(req.headers);
  headers.delete("accept-encoding");
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  if (!body) return new Request(req, { headers });
  headers.delete("content-length");
  return new Request(req.url, { method: req.method, headers, body: JSON.stringify(body), signal: req.signal });
}

class View {
  constructor(
    readonly store: OwnerStore,
    readonly call: Call,
    readonly state: TenantTopology,
  ) {}

  owned(kind: "terminal" | "space", id: JsonValue | undefined) {
    const key = asJsonString(id);
    return key !== undefined && this.store.owner(this.call.session, kind, key) === this.call.actor.sub;
  }

  pane(paneId: JsonValue | undefined) {
    return this.state.panes.find(
      (pane) => pane.paneId === paneId && this.owned("terminal", pane.terminalId) && this.owned("space", pane.spaceId),
    );
  }

  space(spaceId: JsonValue | undefined) {
    // A recycled workspace id cannot authorize its replacement's contents.
    const panes = this.state.panes.filter((p) => p.spaceId === spaceId);
    return this.owned("space", spaceId) && panes.length > 0 && panes.every((p) => this.owned("terminal", p.terminalId));
  }

  terminal(id: JsonValue | undefined) {
    const pane = this.state.panes.find((p) => p.terminalId === id);
    return pane && this.pane(pane.paneId);
  }

  snapshot(body: JsonObject) {
    const { actor, session } = this.call;
    const local = (r: JsonObject) => r.host === undefined && (r.session === undefined || r.session === session);
    const own = (r: JsonObject) => {
      if (!local(r)) return false;
      const p = this.pane(r.paneId);
      return p && p.terminalId === r.terminalId && p.spaceId === r.workspaceId;
    };
    const paneRow = (r: JsonObject) => {
      const pane = pick(r, paneFields);
      const terminal = asJsonString(r.terminalId);
      if (terminal && r.held !== undefined) pane.held = this.receipts(terminal, r.held);
      const trash = asJsonObject(r.trash);
      if (trash) {
        pane.trash = this.owned("space", trash.originalWorkspaceId)
          ? pick(trash, ["trashedAt", "originalWorkspaceId", "workspaceLabel"])
          : { trashedAt: trash.trashedAt, originalWorkspaceId: "" };
      }
      return pane;
    };
    const agents = objects(body.agents).filter(own).map(paneRow);
    const shellPanes = objects(body.shellPanes).filter(own).map(paneRow);
    const visible = [...agents, ...shellPanes];
    const tabs: JsonObject[] = objects(body.tabs)
      .filter((t) => local(t) && visible.some((p) => p.workspaceId === t.workspaceId && p.tabId === t.tabId))
      .map((t) =>
        Object.assign(pick(t, ["tabId", "workspaceId", "number", "label", "focused"]), {
          paneCount: visible.filter((p) => p.tabId === t.tabId && p.workspaceId === t.workspaceId).length,
        }),
      );
    const workspaces = objects(body.workspaces)
      .filter((w) => local(w) && visible.some((p) => p.workspaceId === w.workspaceId))
      .map((w) => {
        const mine = tabs.filter((t) => t.workspaceId === w.workspaceId);
        return Object.assign(pick(w, ["workspaceId", "number", "label", "focused"]), {
          tabCount: mine.length,
          paneCount: visible.filter((p) => p.workspaceId === w.workspaceId).length,
          activeTabId: mine.find((t) => t.tabId === w.activeTabId)?.tabId ?? mine[0]?.tabId ?? "",
        });
      });
    const sessions = objects(body.sessions)
      .filter((s) => local(s) && s.name === session)
      .map((s) => ({
        name: s.name,
        isPrimary: s.isPrimary,
        reachable: s.reachable,
        agents: agents.length,
        working: agents.filter((p) => p.status === "working").length,
        blocked: agents.filter((p) => p.status === "blocked").length,
      }));
    return {
      bridge: body.bridge,
      ts: body.ts,
      agents,
      shellPanes,
      tabs,
      workspaces,
      sessions,
      device: {
        enforced: true,
        device: actor.username,
        authorized: actor.role === "member" && asJsonObject(body.device)?.authorized !== false,
      },
    };
  }

  receipts(terminal: string, value: JsonValue | undefined) {
    const ownRows: JsonObject[] = [];
    for (const row of objects(value)) {
      const id = this.store.clientSendId(this.call.actor.sub, this.call.session, terminal, asJsonString(row.requestId));
      if (id) ownRows.push({ ...row, requestId: id });
    }
    return ownRows;
  }

  order(group: JsonObject) {
    if (!this.owned("space", group.workspaceId) || !Array.isArray(group.paneIds)) return [];
    const paneIds = group.paneIds.filter((id) => this.terminal(id)?.spaceId === group.workspaceId);
    return paneIds.length ? [{ workspaceId: group.workspaceId, paneIds }] : [];
  }
}

export class KopercaTenancy {
  private readonly store: OwnerStore;
  private lane: Promise<void> = Promise.resolve();

  constructor(stateDir: string, legacyOwnerSub: string) {
    this.store = new OwnerStore(stateDir, legacyOwnerSub);
  }

  ownedSessions(sub: string) {
    return this.store.ownedSessions(sub);
  }

  retainTab(session: string, space: string, previous: string, retained: string) {
    const sub = this.store.owner(session, "space", space);
    if (sub && this.store.owner(session, "terminal", previous) === sub) this.store.claim(session, space, retained, sub, false);
  }

  preferencesDir(sub: string) {
    return this.store.preferencesDir(sub);
  }

  async handle(call: Call): Promise<Response> {
    const { actor, req, pathname } = call;
    this.store.account(actor);
    if (pathname === "/api/agent-defaults") return this.agentDefaults(call);
    if (pathname === "/api/user-settings" || pathname === "/api/user-settings/owners") return this.settings(call);
    if (actor.role !== "admin" && new URL(req.url).searchParams.has("host")) return hidden();
    // The tap-resume POST refreshes the local census and returns only { ok: true }.
    if (pathname === "/api/refresh" && req.method === "POST") return call.next(req);
    if (actor.role === "viewer" && req.method !== "GET" && req.method !== "HEAD") return forbidden();
    if (req.method === "GET" || req.method === "HEAD") return this.route(call);
    // Finish receiving a bounded browser body before the mux census. A slow upload
    // must neither hold the mutation lane nor keep an old ownership check alive.
    if (req.body && (actor.role !== "admin" || pathname === "/api/workspace-owners")) {
      const bytes = await req.arrayBuffer();
      const buffered = new Request(req.url, { method: req.method, headers: req.headers, body: bytes, signal: req.signal });
      call = { ...call, req: buffered };
    }
    // Serialise ownership checks with Collie topology mutations, including admin moves.
    const work = this.lane.then(() => call.active?.() === false ? expired() : this.route(call));
    this.lane = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  }

  private async agentDefaults({ actor, req, active, profileStore }: Call) {
    const sub = new URL(req.url).searchParams.get("owner") ?? actor.sub;
    if ((sub !== actor.sub && actor.role !== "admin") || !profileStore || !this.store.hasAccount(sub)) return hidden();
    const profile = profileStore(this.store.preferencesDir(sub));
    if (req.method === "GET") return json(profile.catalog());
    if (req.method !== "PUT" || actor.role === "viewer") return forbidden();
    const raw = await req.text();
    if (active?.() === false) return expired();
    const result = raw.length <= 1024 && profile.resolve(parseJson(raw));
    if (!result) return bad();
    return profile.save(result.prefs) ? json(result.prefs) : new Response(null, { status: 503 });
  }

  private async settings({ actor, req, pathname, active }: Call) {
    if (pathname.endsWith("/owners")) return actor.role === "admin" && req.method === "GET" ? json(this.store.accounts()) : hidden();
    const sub = new URL(req.url).searchParams.get("owner") ?? actor.sub;
    if (sub !== actor.sub && actor.role !== "admin") return hidden();
    if (req.method === "GET") return json(this.store.settings(sub));
    if (req.method !== "PATCH" || actor.role === "viewer") return forbidden();
    const raw = await req.text();
    if (active?.() === false) return expired();
    if (Buffer.byteLength(raw) > 1024 * 1024) return bad();
    const input = parseJsonObject(raw);
    const set = asJsonObject(input?.set);
    const remove = input?.remove;
    if (!set || !Array.isArray(remove)) return bad();
    const changes: [string, string][] = [];
    for (const [key, value] of Object.entries(set)) {
      const text = asJsonString(value);
      if (!validSettingName(key) || text === undefined) return bad();
      changes.push([key, text]);
    }
    const keys: string[] = [];
    for (const item of remove) {
      const key = asJsonString(item);
      if (key === undefined || !validSettingName(key)) return bad();
      keys.push(key);
    }
    return this.store.patch(sub, Object.fromEntries(changes), keys) ? json(this.store.settings(sub)) : bad();
  }

  private async route(call: Call): Promise<Response> {
    const { req, actor, pathname, session, next } = call;
    const admin = actor.role === "admin";
    const create = req.method === "POST" && ["/api/launch", "/api/workspace", "/api/tab"].includes(pathname);
    const ownership = pathname === "/api/workspace-owners";
    if (ownership && (!admin || new URL(req.url).searchParams.has("host"))) return hidden();
    if (!ownership && admin && (!create || new URL(req.url).searchParams.has("host"))) return next(req);
    if (pathname === "/api/health" && req.method === "GET") return json({ ok: true });
    if (req.method === "GET" && (pathname === "/api/config" || pathname === "/api/launchers")) {
      const res = await next(plainRequest(req));
      if (!res.ok) return res;
      const body = parseJsonObject(await res.text());
      if (!body) return conflict();
      if (pathname === "/api/config")
        return json({ push: false, vapidPublicKey: "", apiVersion: body.apiVersion, build: body.build, mux: body.mux });
      return json({ launchers: [], home: "", harnesses: body.harnesses, botCreate: body.botCreate });
    }

    if (
      !scopedRoutes.has(pathname) &&
      !panePath.test(pathname) &&
      !spacePath.test(pathname) &&
      !(req.method === "DELETE" && cancelPath.test(pathname))
    )
      return forbidden();
    const state = await call.topology();
    this.store.bootstrap(session, state);
    const view = new View(this.store, call, state);
    if (ownership) return this.ownership(call, state);
    if (create) return this.create(call, view);
    if (req.method === "GET" && ["/api/snapshot", "/api/chat-order"].includes(pathname)) {
      const res = await next(plainRequest(req));
      if (!res.ok) return res;
      const body = parseJson(await res.text());
      if (pathname === "/api/chat-order") return json(objects(body).flatMap((group) => view.order(group)));
      const snapshot = asJsonObject(body);
      return snapshot ? json(view.snapshot(snapshot)) : conflict();
    }
    const paneRoute = panePath.exec(pathname);
    if (paneRoute) {
      const pane = view.pane(decode(paneRoute[1]!));
      const action = paneRoute[2] ?? "";
      if (!pane) return hidden();
      if (req.method === "GET" && ["", "chat", "history"].includes(action)) {
        const response = await next(plainRequest(req));
        const current = (await call.topology()).panes.find((p) => p.paneId === pane.paneId);
        return current?.terminalId === pane.terminalId && current?.spaceId === pane.spaceId && view.pane(pane.paneId) ? response : hidden();
      }
      if (req.method === "POST" && ["rename", "keys", "upload", "close"].includes(action)) return next(req);
      if (req.method === "POST" && (action === "reply" || action === "arrived")) {
        const body = parseJsonObject(await req.clone().text());
        if (!body) return bad();
        if (action === "arrived") {
          const id = this.store.sendReference(actor.sub, session, pane.terminalId!, asJsonString(body.requestId));
          return id ? next(plainRequest(req, { ...body, requestId: id })) : hidden();
        }
        return body.id === undefined ? next(req) : this.send(call, pane.terminalId!, body);
      }
      return forbidden();
    }
    if (req.method === "GET" && pathname === "/api/send/receipts") {
      const pane = view.pane(new URL(req.url).searchParams.get("pane") ?? "");
      if (!pane?.terminalId) return hidden();
      const res = await next(plainRequest(req));
      if (!res.ok) return res;
      const rows = parseJsonObject(await res.text())?.receipts;
      if (!view.pane(pane.paneId)) return hidden();
      return json({ receipts: view.receipts(pane.terminalId, rows) });
    }
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const clientId = cancelPath.exec(pathname)?.[1];
      const pane = view.pane(url.searchParams.get("pane"));
      if (!clientId || !pane?.terminalId) return hidden();
      const internal = this.store.sendReference(actor.sub, session, pane.terminalId, clientId);
      if (!internal) return hidden();
      url.pathname = "/api/send/" + internal;
      return next(new Request(url, { method: req.method, headers: req.headers, signal: req.signal }));
    }
    if (req.method !== "POST") return forbidden();
    const body = parseJsonObject(await req.clone().text());
    if (!body) return bad();
    if (pathname === "/api/send") {
      const pane = view.pane(body.pane);
      if (!pane || body.view !== undefined) return hidden();
      return this.send(call, pane.terminalId!, body);
    }
    const spaceAction = spacePath.exec(pathname);
    if (spaceAction) {
      if (!view.space(decode(spaceAction[1]!)) || (spaceAction[2] === "move" && body.before !== null && !view.space(body.before)))
        return hidden();
      return next(req);
    }
    if (pathname === "/api/chat-order") {
      const inSpace = (id: JsonValue | undefined) => view.terminal(id)?.spaceId === body.workspaceId;
      if (!view.space(body.workspaceId) || !inSpace(body.paneId) || (body.before !== null && !inSpace(body.before))) return hidden();
      return next(req);
    }
    if (pathname === "/api/bot-action") {
      if (body.action === "trashWorkspace" || body.action === "restoreWorkspace") {
        if (!view.space(body.workspaceId)) return hidden();
        if (
          body.action === "restoreWorkspace" &&
          (!call.trash ||
            state.panes.some(
              (p) => p.terminalId && call.trash?.(p.terminalId)?.originalWorkspaceId === body.workspaceId && !view.terminal(p.terminalId),
            ))
        )
          return hidden();
      } else {
        const pane = view.terminal(body.terminalId);
        if (!pane || !["trash", "move", "restore", "purge"].includes(String(body.action))) return hidden();
        const dest = body.workspaceId ?? (body.action === "restore" ? call.trash?.(pane.terminalId!)?.originalWorkspaceId : undefined);
        if ((dest !== undefined || body.action === "restore" || body.action === "move") && !view.space(dest)) return hidden();
      }
      return next(req);
    }
    return forbidden();
  }

  private async send(call: Call, terminal: string, body: JsonObject) {
    const clientId = asJsonString(body.id);
    if (!clientId || !REQUEST_ID.test(clientId)) return bad();
    const { sub } = call.actor;
    const resend =
      body.resendOf === undefined ? undefined : this.store.sendReference(sub, call.session, terminal, asJsonString(body.resendOf));
    if (body.resendOf !== undefined && !resend) return hidden();
    // Prepare is stateless. All other sends, including the old reply form, share the bridge's
    // machine-wide receipt book. Never let the caller select a row in that book directly.
    if (body.mode === "prepare") return body.resendOf === undefined ? call.next(call.req) : bad();
    const id = this.store.requestId(sub, call.session, "send:" + terminal, clientId, "");
    if (!id) return conflict();
    const reply = await call.next(plainRequest(call.req, { ...body, id, resendOf: resend }));
    if (!reply.ok) return reply;
    const out = parseJsonObject(await reply.text());
    if (!out) return conflict();
    const receipt = asJsonObject(asJsonObject(out.send)?.receipt ?? out.receipt);
    if (receipt?.requestId === id) receipt.requestId = clientId;
    if (receipt?.acknowledged === id) receipt.acknowledged = clientId;
    return json(out);
  }

  private async ownership(call: Call, state: TenantTopology) {
    if (call.req.method === "GET") {
      return json(
        state.spaces.map((space) => ({ workspaceId: space.spaceId, sub: this.store.owner(call.session, "space", space.spaceId) ?? null })),
      );
    }
    if (call.req.method !== "PUT") return forbidden();
    const body = parseJsonObject(await call.req.text());
    const workspace = asJsonString(body?.workspaceId);
    const sub = asJsonString(body?.sub);
    if (!workspace || !sub) return bad();
    if (!state.spaces.some((s) => s.spaceId === workspace)) return hidden();
    const panes = state.panes.filter((p) => p.spaceId === workspace);
    const terminals = panes.map((p) => p.terminalId).filter((id): id is string => Boolean(id));
    if (!terminals.length || terminals.length !== panes.length || new Set(terminals).size !== panes.length) return conflict();
    if (
      !call.hasTrashForWorkspace ||
      !call.trash ||
      call.hasTrashForWorkspace(workspace) ||
      terminals.some((id) => call.trash?.(id) !== undefined)
    )
      return conflict();
    if (state.panes.some((p) => p.spaceId !== workspace && p.terminalId && terminals.includes(p.terminalId))) return conflict();
    if (call.active?.() === false) return expired();
    return this.store.transfer(call.session, workspace, terminals, sub) ? json({ ok: true }) : hidden();
  }

  private async create(call: Call, view: View) {
    const { actor, session, req, pathname, next } = call;
    const admin = actor.role === "admin";
    const body = parseJsonObject(await req.clone().text());
    if (!body || !isRequestId(body.requestId)) return admin ? next(req) : bad();
    const beside = body.paneId === undefined ? undefined : view.pane(body.paneId);
    const target = pathname === "/api/tab" ? body.workspaceId : beside?.spaceId;
    if (!admin) {
      const allowed = ["requestId", "label"];
      if (pathname === "/api/launch") allowed.push("paneId", "harness", "botCreate", "shell");
      if (pathname === "/api/tab") allowed.push("workspaceId");
      if (Object.keys(body).some((k) => !allowed.includes(k))) return forbidden();
      if ((body.paneId !== undefined && !beside) || (pathname === "/api/tab" && !view.space(target))) return hidden();
    }
    const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const internal = this.store.requestId(actor.sub, session, pathname, body.requestId, fingerprint);
    if (!internal) return conflict();
    const result = await next(plainRequest(req, { ...body, requestId: internal }));
    if (!result.ok) return result;
    const output = parseJsonObject(await result.text());
    if (!output) return conflict();
    const pane = asJsonObject(output.pane);
    if (output.ok !== true || !pane) return json(output);
    const live = (await call.topology()).panes.find((item) => item.paneId === pane.paneId && item.spaceId === pane.workspaceId);
    if (!live?.terminalId) return admin ? json(output) : conflict();
    if (admin) {
      // A tab an administrator adds to another person's workspace belongs to that workspace.
      const existingOwner = this.store.owner(session, "space", live.spaceId);
      this.store.claim(session, live.spaceId, live.terminalId, existingOwner ?? actor.sub, existingOwner === undefined);
      return json(output);
    }
    const exists = view.state.panes.some((p) => p.terminalId === live.terminalId);
    if (exists && !this.store.owner(session, "terminal", live.terminalId)) return conflict();
    if (target !== undefined && target !== live.spaceId) return conflict();
    if (!this.store.claim(session, live.spaceId, live.terminalId, actor.sub, target === undefined)) return conflict();
    return json(output);
  }
}
