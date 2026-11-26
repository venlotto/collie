// Koperca's internal SSO has a rotating, parent-domain refresh cookie. Only this bridge calls
// /session. A host-only opaque cookie binds a browser to its last verified grant; the JWT, refresh
// response body and upstream errors never enter a browser response or a log.
import { createHash, randomBytes } from "node:crypto";
import type { JsonValue } from "./json.ts";
import { jsonRecord, jsonNumberField, jsonStringField } from "./stt/json.ts";

export type SsoRole = "admin" | "member" | "viewer";
export interface SsoPrincipal {
  sub: string;
  username: string;
  role: SsoRole;
}

type Environment = Readonly<Partial<Record<string, string>>>;
type FetchSso = (url: string, init: RequestInit) => Promise<Response>;
const LOCAL_COOKIE = "__Host-collie-sso";
const DAY = 86_400_000;
const ROLES: readonly SsoRole[] = ["admin", "member", "viewer"];

type Grant = {
  sub: string;
  principal: SsoPrincipal | null;
  access: string;
  expires: number;
  rotated: string;
  refresh: string;
};
type Exchange = Grant | 401 | 503;
interface LocalSession {
  id: string;
  until: number;
  grant: Grant;
  // A late request from the same already-authenticated tab may arrive just after /session
  // finishes and before its Set-Cookie reaches the browser. Never send a spent token again.
  previous: string;
  previousUntil: number;
}

function digest(cookie: string): string {
  return createHash("sha256").update(cookie).digest("hex");
}

function httpsUrl(raw: string): URL {
  if (!URL.canParse(raw)) throw new Error("Invalid HTTPS URL in Collie SSO configuration");
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new Error("Invalid HTTPS URL in Collie SSO configuration");
  }
  return parsed;
}

// Cookie-octets, with an explicit cap; duplicate names (including domain/path shadows) fail closed.
function cookieFrom(req: Request, name: string): string | null {
  const parts = (req.headers.get("cookie") ?? "").split(";").map((v) => v.trim())
    .filter((v) => v.startsWith(name + "="));
  if (parts.length !== 1) return null;
  const value = parts[0]?.slice(name.length + 1) ?? "";
  return /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]{1,4096}$/.test(value) ? value : null;
}

function privateResponse(body: string | null, status: number, location?: string): Response {
  const headers = new Headers({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
  if (location) headers.set("Location", location);
  return new Response(body, { status, headers });
}

function localCookie(id: string): string {
  return LOCAL_COOKIE + "=" + id + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + (id ? 604800 : 0);
}

export function createKopercaSso(env: Environment = process.env, fetcher: FetchSso = fetch, now = Date.now) {
  const enabled = (env.COLLIE_SSO_ENABLED ?? "").trim().toLowerCase();
  if (["", "0", "false"].includes(enabled)) return null;
  if (!["1", "true"].includes(enabled)) throw new Error("Invalid COLLIE_SSO_ENABLED");

  const site = httpsUrl(env.COLLIE_SSO_ORIGIN ?? "https://collie.dev1.koperca.com");
  if (site.pathname !== "/" || (env.COLLIE_BASE_PATH && env.COLLIE_BASE_PATH !== "/")) {
    throw new Error("Collie SSO requires a dedicated origin at the root path");
  }
  const login = httpsUrl(env.INTERNAL_LOGIN_URL ?? "https://login-internal.dev1.koperca.com");
  login.searchParams.set("redirect_uri", Buffer.from(site.origin + "/auth/callback").toString("base64"));
  const api = httpsUrl(env.AUTH_API_BASE_URL ?? env.SSO_BASE_URL ?? "https://dev1.koperca.com/service.sso-internal");
  const endpoint = api.href.replace(/\/$/, "") + "/v1/auth/";
  const name = env.SESSION_COOKIE_NAME ?? "plus_session";
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || name === LOCAL_COOKIE) {
    throw new Error("Invalid SESSION_COOKIE_NAME");
  }

  const sessions = new Map<string, LocalSession>();
  const pending = new Map<string, Promise<Exchange>>();
  const issued = new WeakMap<Grant, LocalSession>();
  const used = new WeakMap<Request, LocalSession>();
  const cookies = new WeakMap<Request, string[]>();
  function finish(req: Request, response: Response): Response {
    const result = new Response(response.body, response);
    result.headers.set("Cache-Control", "private, no-store");
    result.headers.set("Referrer-Policy", "no-referrer");
    for (const value of cookies.get(req) ?? []) result.headers.append("Set-Cookie", value);
    cookies.delete(req);
    return result;
  }

  async function exchange(refresh: string): Promise<Exchange> {
    try {
      const answer = await fetcher(endpoint + "session", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
        headers: { cookie: name + "=" + refresh, "content-type": "application/json" }, body: "{}",
      });
      if (answer.status === 401 || answer.status === 403) return 401;
      if (!answer.ok) return 503;
      const all = answer.headers.getSetCookie().filter((value) => value.startsWith(name + "="));
      const rotated = all[0];
      if (all.length !== 1 || !rotated || !/;\s*httponly(?:;|$)/i.test(rotated) || !/;\s*secure(?:;|$)/i.test(rotated)) return 503;
      const first = rotated.split(";", 1)[0] ?? "";
      const next = cookieFrom(new Request(site, { headers: { cookie: first } }), name);
      const raw: JsonValue = await answer.json();
      const envelope = jsonRecord(raw);
      const body = jsonRecord(envelope?.data) ?? envelope;
      const access = jsonStringField(body?.access_token);
      if (!next || !access) return 503;
      // Only tokens just received from the configured TLS endpoint enter this parser. Browser
      // bearers never get here. The JWT limits the lifetime of the decision cached in the bridge.
      const pieces = access.split(".");
      if (pieces.length !== 3 || !pieces[0] || !pieces[1] || !pieces[2]) return 503;
      const decoded: JsonValue = JSON.parse(Buffer.from(pieces[1], "base64url").toString("utf8"));
      const claims = jsonRecord(decoded);
      const sub = jsonStringField(claims?.sub);
      const username = jsonStringField(claims?.username);
      const exp = jsonNumberField(claims?.exp);
      const permissions = claims?.permissions;
      if (!sub || !username || !exp || !Array.isArray(permissions) || !Array.isArray(claims?.roles)) return 503;
      const expires = Math.min(now() + 300_000, exp * 1000);
      if (expires <= now()) return 401;
      const role = ROLES.find((r) => permissions.includes("com.lotto.web.collie:" + r));
      return { sub, principal: role ? { sub, username, role } : null, access, rotated, refresh: next, expires };
    } catch {
      return 503;
    }
  }

  function renew(refresh: string): Promise<Exchange> {
    const key = digest(refresh);
    const started = pending.get(key);
    if (started) return started;
    if (pending.size >= 128) return Promise.resolve(503);
    const work = exchange(refresh).finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  }

  function issue(grant: Grant, previous: string): LocalSession | null {
    const shared = issued.get(grant);
    if (shared) return sessions.get(shared.id) ?? null;
    for (const [key, value] of sessions) if (value.until <= now()) sessions.delete(key);
    // Cap restart-local browser sessions even if clients repeatedly re-open the callback.
    const oldest = sessions.keys().next().value;
    if (sessions.size >= 4096 && oldest) sessions.delete(oldest);
    const id = randomBytes(32).toString("base64url");
    const session = { id, until: now() + 7 * DAY, grant, previous: digest(previous), previousUntil: now() + 5000 };
    sessions.set(id, session);
    issued.set(grant, session);
    return session;
  }

  function logoutCookies(grant: Grant): string[] {
    // Retain the issuer's exact domain/path even when remote revocation is unavailable.
    const attributes = grant.rotated.split(";").slice(1).map((p) => p.trim())
      .filter((p) => !/^(max-age|expires)=/i.test(p));
    return [localCookie(""), [name + "=", ...attributes, "Max-Age=0"].join("; ")];
  }

  function active(req: Request, principal: SsoPrincipal): boolean {
    const session = used.get(req);
    return !!session && sessions.get(session.id) === session && session.until > now() && session.grant.expires > now()
      && session.grant.principal?.sub === principal.sub && session.grant.principal.role === principal.role;
  }

  async function authorize(req: Request, pathname: string): Promise<Response | SsoPrincipal> {
    const host = req.headers.get("host") ?? new URL(req.url).host;
    const origin = req.headers.get("origin");
    const needsOrigin = !["GET", "HEAD"].includes(req.method) || req.headers.has("upgrade");
    if (host.toLowerCase() !== site.host || ((needsOrigin || origin !== null) && origin !== site.origin)) {
      return privateResponse("Origen de Collie no permitido", 403);
    }

    const reply = (body: string | null, status: number, location?: string) =>
      finish(req, privateResponse(body, status, location));
    const expected = req.headers.get("X-Collie-Subject");
    const subjectChanged = (sub: string) => expected !== null && expected !== encodeURIComponent(sub);
    const changed = () => finish(req, new Response("La cuenta cambió", {
      status: 409, headers: { "X-Collie-Session": "changed" },
    }));
    const nav = req.method === "GET" && (pathname === "/" || req.headers.get("sec-fetch-mode") === "navigate")
      && !pathname.startsWith("/api/") && !pathname.startsWith("/auth/") && !req.headers.has("upgrade");
    const fail = (status: 401 | 503): Response => {
      if (status === 401 && nav) return reply(null, 303, login.href);
      return reply(status === 401 ? "Sesión interna requerida" : "SSO interno no disponible", status);
    };

    if (pathname === "/auth/login") return req.method === "GET" ? reply(null, 303, login.href) : reply(null, 405);

    const refresh = cookieFrom(req, name);
    const sessionId = cookieFrom(req, LOCAL_COOKIE);
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (pathname === "/auth/callback") {
      if (req.method !== "GET") return reply(null, 405);
      if (!refresh) return reply("El callback requiere la cookie del SSO interno en este dominio", 401);
      const grant = await renew(refresh);
      if (grant === 401 || grant === 503) return fail(grant);
      if (session) sessions.delete(session.id);
      cookies.set(req, [grant.rotated, localCookie("")]);
      if (!grant.principal) return reply("Permiso de Collie requerido", 403);
      const made = issue(grant, refresh);
      if (!made) return fail(401);
      cookies.set(req, [grant.rotated, localCookie(made.id)]);
      return reply(null, 303, site.origin + "/");
    }

    const logout = pathname === "/auth/logout";
    if (logout && req.method !== "POST") return reply(null, 405);
    if (pathname === "/auth/me" && req.method !== "GET") return reply(null, 405);
    if (!session || session.until <= now() || !refresh) {
      if (session) sessions.delete(session.id);
      if (logout) cookies.set(req, session ? logoutCookies(session.grant) : [localCookie("")]);
      if (nav && refresh) return reply(null, 303, site.origin + "/auth/callback");
      return fail(401);
    }

    const before = session.grant;
    if (subjectChanged(before.sub)) return changed();
    const current = before.refresh === refresh || (session.previousUntil > now() && session.previous === digest(refresh));
    if (!current || before.expires <= now()) {
      const grant = await renew(refresh);
      if (grant === 401 || grant === 503) {
        if (logout || grant === 401) sessions.delete(session.id);
        if (logout) cookies.set(req, logoutCookies(before));
        return fail(grant);
      }
      if (sessions.get(session.id) !== session) return fail(401);
      cookies.set(req, [grant.rotated]);
      if (grant.sub !== before.sub) {
        // A different Koperca app switched accounts. Require a fresh navigation before any
        // in-flight request from the old UI can operate as the new account.
        sessions.delete(session.id);
        cookies.set(req, [grant.rotated, localCookie("")]);
        if (subjectChanged(grant.sub)) return changed();
        return nav ? reply(null, 303, site.origin + "/auth/callback") : fail(401);
      }
      session.previous = digest(refresh);
      session.previousUntil = now() + 5000;
      session.grant = grant;
    }

    const grant = session.grant;
    if (logout) {
      sessions.delete(session.id);
      cookies.set(req, logoutCookies(grant));
      try {
        const answer = await fetcher(endpoint + "logout", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
          headers: { cookie: name + "=" + grant.refresh, authorization: "Bearer " + grant.access, "content-type": "application/json" },
          body: "{}",
        });
        return answer.ok ? reply(null, 204) : reply("No se pudo cerrar la sesión remota", 503);
      } catch {
        return reply("No se pudo cerrar la sesión remota", 503);
      }
    }

    if (!grant.principal) {
      const denied = reply("Permiso de Collie requerido", 403);
      denied.headers.set("X-Collie-Session", "changed");
      return denied;
    }
    const expectedRole = req.headers.get("X-Collie-Role");
    if (expectedRole !== null && expectedRole !== grant.principal.role) return changed();
    used.set(req, session);
    if (pathname === "/auth/me") return finish(req, Response.json(grant.principal));
    return grant.principal;
  }

  return { authorize, finish, active };
}
