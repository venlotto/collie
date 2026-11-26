import { describe, expect, test } from "bun:test";
import { createKopercaSso } from "./koperca-sso.ts";

const ORIGIN = "https://collie.dev1.koperca.com";
const PATH = "/auth/callback";
const LOCAL = "__Host-collie-sso";
const REMOTE = "dev_team_fixture";

function request(path: string, cookie = "", method = "GET", origin?: string): Request {
  const headers = new Headers({ host: new URL(ORIGIN).host, cookie });
  if (origin !== undefined) headers.set("origin", origin);
  return new Request("http://127.0.0.1" + path, { method, headers });
}

function fixture() {
  const state = { time: 100_000, sub: "fixture-a", username: "Tester", roles: ["Collie Admin"], permissions: ["member"],
    sessionCalls: 0, logoutCalls: 0, remoteStatus: 201, logoutStatus: 204, invalid: false };
  const calls: { path: string; init: RequestInit }[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    if (path.endsWith("/logout")) {
      state.logoutCalls++;
      return new Response(null, { status: state.logoutStatus });
    }
    state.sessionCalls++;
    if (state.remoteStatus !== 201) return new Response(null, { status: state.remoteStatus });
    const claims = { sub: state.sub, username: state.username, roles: state.roles,
      permissions: state.permissions.map((r) => "com.lotto.web.collie:" + r), exp: state.time / 1000 + 60 };
    const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return Response.json({ data: { access_token: state.invalid ? "invalid" : "fixture." + encoded + ".fixture" } }, {
      headers: { "Set-Cookie": REMOTE + "=fixture" + state.sessionCalls + "; Path=/; Domain=.dev1.koperca.com; HttpOnly; Secure; SameSite=Lax" },
      status: 201,
    });
  };
  const auth = createKopercaSso({ COLLIE_SSO_ENABLED: "1", SESSION_COOKIE_NAME: REMOTE }, fetcher, () => state.time)!;
  const authReq = (req: Request) => auth.authorize(req, new URL(req.url).pathname);
  const callback = async (refresh = "fixture0") => {
    const result = await authReq(request(PATH, REMOTE + "=" + refresh));
    if (!(result instanceof Response)) throw new Error("expected callback response");
    const cookie = result.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ");
    return { result, cookie };
  };
  return { state, auth, calls, authReq, callback };
}

describe("the Koperca SSO browser door", () => {
  test("the disabled bridge has no SSO; invalid configuration fails startup", () => {
    expect(createKopercaSso({})).toBeNull();
    expect(createKopercaSso({ COLLIE_SSO_ENABLED: "0" })).toBeNull();
    expect(() => createKopercaSso({ COLLIE_SSO_ENABLED: "enabled" })).toThrow();
    expect(() => createKopercaSso({ COLLIE_SSO_ENABLED: "true", AUTH_API_BASE_URL: "http://wrong.invalid" })).toThrow();
  });

  test("anonymous navigation redirects to the pinned login and callback; API never redirects to HTML", async () => {
    const { authReq, state } = fixture();
    const redirect = await authReq(request("/"));
    if (!(redirect instanceof Response)) throw new Error("expected login");
    const location = new URL(redirect.headers.get("location") ?? "");
    expect(location.origin).toBe("https://login-internal.dev1.koperca.com");
    expect(Buffer.from(location.searchParams.get("redirect_uri") ?? "", "base64").toString()).toBe(ORIGIN + PATH);
    expect(await authReq(request("/api/snapshot"))).toHaveProperty("status", 401);
    expect(await authReq(request(PATH))).toHaveProperty("status", 401);
    expect(state.sessionCalls).toBe(0);
    expect(await authReq(request("/api/snapshot", "", "POST", "https://elsewhere.invalid"))).toHaveProperty("status", 403);
    expect(await authReq(request("/api/snapshot", "", "POST"))).toHaveProperty("status", 403);
    const spoof = request(PATH, REMOTE + "=fixture");
    spoof.headers.set("host", "coder1.tail44dd87.ts.net");
    spoof.headers.set("x-forwarded-host", new URL(ORIGIN).host);
    expect(await authReq(spoof)).toHaveProperty("status", 403);
  });

  test("only the SSO cookie is exchanged and the browser sees only its own profile", async () => {
    const { authReq, callback, calls, state } = fixture();
    const { result, cookie } = await callback("fixture0; some-other-system=private-fixture");
    expect(result.status).toBe(303);
    expect(result.headers.get("location")).toBe(ORIGIN + "/");
    expect(result.headers.getSetCookie()).toHaveLength(2);
    expect(result.headers.getSetCookie().find((v) => v.startsWith(LOCAL + "="))).toContain("HttpOnly; Secure");
    expect(calls[0]?.init.headers).toMatchObject({ cookie: REMOTE + "=fixture0" });
    const profile = await authReq(request("/auth/me", cookie));
    if (!(profile instanceof Response)) throw new Error("expected profile");
    expect(await profile.json()).toEqual({ sub: state.sub, username: state.username, role: "member" });
    expect(profile.headers.get("cache-control")).toContain("no-store");
    expect(await authReq(request("/api/settings", LOCAL + "=forged; " + REMOTE + "=fixture1"))).toHaveProperty("status", 401);
    expect(await authReq(request("/api/settings", cookie + "; " + REMOTE + "=duplicate"))).toHaveProperty("status", 401);
    expect(state.sessionCalls).toBe(1);
  });

  test("exact permissions only; admin wins over member and viewer; upstream errors are private", async () => {
    const { authReq, callback, state } = fixture();
    state.permissions = ["admin:fake"];
    const denied = await callback();
    expect(denied.result.status).toBe(403);
    expect(denied.result.headers.getSetCookie()[0]).toStartWith(REMOTE + "=fixture1;");
    state.permissions = ["viewer", "admin", "member"];
    const admin = await callback();
    expect(await authReq(request("/api/snapshot", admin.cookie))).toHaveProperty("role", "admin");
    state.invalid = true;
    expect((await callback()).result.status).toBe(503);
    state.remoteStatus = 401;
    expect((await callback()).result.status).toBe(401);
  });

  test("requests sharing a refresh cookie exchange once, refresh again on JWT expiry, and see demotion", async () => {
    const { auth, authReq, callback, state } = fixture();
    const [a, b] = await Promise.all([callback(), callback()]);
    expect(a.result.status).toBe(303);
    expect(b.result.status).toBe(303);
    expect(a.cookie === b.cookie).toBe(true);
    expect(state.sessionCalls).toBe(1);
    const stream = request("/stream", a.cookie);
    const member = await authReq(stream);
    if (member instanceof Response) throw new Error("expected member");
    expect(auth.active(stream, member)).toBe(true);
    state.time += 61_000;
    expect(auth.active(stream, member)).toBe(false);
    state.permissions = ["viewer"];
    const first = request("/api/snapshot", a.cookie);
    const second = request("/api/settings", a.cookie);
    const answers = await Promise.all([authReq(first), authReq(second)]);
    expect(answers.every((v) => !(v instanceof Response) && v.role === "viewer")).toBe(true);
    expect(state.sessionCalls).toBe(2);
    expect(auth.finish(first, new Response()).headers.getSetCookie()[0]).toStartWith(REMOTE + "=fixture2;");
    expect(auth.finish(second, new Response()).headers.getSetCookie()[0]).toStartWith(REMOTE + "=fixture2;");
    expect(auth.active(stream, member)).toBe(false);
    expect(await authReq(request("/api/snapshot", a.cookie))).toHaveProperty("role", "viewer");
    expect(state.sessionCalls).toBe(2);
  });

  test("a changed upstream account cannot run an in-flight operation under the old UI", async () => {
    const { authReq, callback, state } = fixture();
    const { cookie } = await callback();
    state.sub = "fixture-b";
    const switched = cookie.replace(REMOTE + "=fixture1", REMOTE + "=changed");
    expect(await authReq(request("/api/send", switched, "POST", ORIGIN))).toHaveProperty("status", 401);
    expect(await authReq(request("/api/settings", cookie))).toHaveProperty("status", 401);
  });

  test("logout requires origin, invalidates streams immediately and revokes using the newest refresh and bearer", async () => {
    const { auth, authReq, callback, calls, state } = fixture();
    const { cookie } = await callback();
    const stream = request("/stream", cookie);
    const p = await authReq(stream);
    if (p instanceof Response) throw new Error("expected authorized stream");
    expect(await authReq(request("/auth/logout", cookie, "POST"))).toHaveProperty("status", 403);
    expect(auth.active(stream, p)).toBe(true);
    const stale = request("/auth/logout", cookie, "POST", ORIGIN);
    stale.headers.set("X-Collie-Subject", "other-account");
    const mismatch = await authReq(stale);
    expect(mismatch).toHaveProperty("status", 409);
    expect(mismatch instanceof Response && mismatch.headers.get("X-Collie-Session")).toBe("changed");
    expect(auth.active(stream, p)).toBe(true);
    const logout = await authReq(request("/auth/logout", cookie, "POST", ORIGIN));
    if (!(logout instanceof Response)) throw new Error("expected logout");
    expect(logout.status).toBe(204);
    expect(logout.headers.getSetCookie().every((v) => v.includes("Max-Age=0"))).toBe(true);
    expect(calls.at(-1)?.init.headers).toMatchObject({ cookie: REMOTE + "=fixture1", authorization: expect.stringMatching(/^Bearer /) });
    expect(state.logoutCalls).toBe(1);
    expect(auth.active(stream, p)).toBe(false);
    expect(await authReq(request("/api/settings", cookie))).toHaveProperty("status", 401);
  });
  test("upstream outage during logout expires both cookies and closes local reads", async () => {
    const { authReq, callback, state } = fixture();
    const { cookie } = await callback();
    state.time += 61_000;
    state.remoteStatus = 503;
    const logout = await authReq(request("/auth/logout", cookie, "POST", ORIGIN));
    if (!(logout instanceof Response)) throw new Error("expected failure");
    expect(logout.status).toBe(503);
    const clear = logout.headers.getSetCookie();
    expect(clear).toHaveLength(2);
    expect(clear.every((v) => v.includes("Max-Age=0"))).toBe(true);
    expect(clear.some((v) => v.startsWith(REMOTE + "=;") && v.includes("Domain=.dev1.koperca.com"))).toBe(true);
    expect(await authReq(request("/api/settings", cookie))).toHaveProperty("status", 401);
  });

});
