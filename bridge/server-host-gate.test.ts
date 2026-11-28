import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("the host gate — `?host=` selects among enrolled members and nothing else", () => {
  const src = readFileSync(join(import.meta.dir, "server.ts"), "utf8");

  test("the selector is parsed only when a crew surface is mounted", () => {
    // The same trust-store-existence predicate the crew router mounts on: a solo instance never
    // applies the `?host=` grammar to a URL at all (§11).
    expect(src).toContain("const host = crewHandler ? selectHostFrom(url) : LOCAL_HOST;");
  });

  test("every session-scoped route resolves through the gate, never past it", () => {
    // The load-bearing claim: `?h=laptop` + `w1:p1` must never be served the DESK's `w1:p1`, and
    // pane ids collide across machines, so a fall-through here is a cross-host write.
    //
    // The session-scoped route handlers (tab create, workspace create, launch, this host's launcher
    // rows, this host's folder list and a star on it, one journal blob, a Claude subagent transcript, a workspace's Changes list,
    // a workspace's Files view, the Files existence check by pane or workspace, the Files image read
    // by pane or workspace (ADR 0090), the Claude commands a pane would load, tab action, the space rename (M53 spec 05), the pane family, "look now", the New sheet's
    // branch plan and create from a folder (ADR 0093), and the
    // three writes on a phone's own launcher rows, served by one function (ADR 0094), and the two
    // writes on this machine's one-off command history, served by one function (ADR 0095), and the
    // read that checks a typed line before it runs (ADR 0095, amendment), and a durable program's
    // conversation list and the items or reopen of one (M53 spec 11), and Sent's read and its two
    // writes, served by one function with one resolve for the read and one for the writes (ADR 0107),
    // and the New page's folder browser (#467), and a session's walky talky off switch (M89 spec 04), and the two routes of this machine's "Worktree folder" setting (ADR 0093, note of 2026-11-13), and
    // this machine's accounts, one resolve for the read and one for the two writes (M101), and an
    // answer to an ask by id, the hook hold card's tap on a member's pane (M56 spec 12)) reach their runtime through the caller's resolver and
    // nothing else. One of them, the launcher rows, hands the resolver the lead's merge (ADR 0127), and
    // two, the launch and the branch create, hand it the lead's row carry (ADR 0127 point 3). The project
    // picture (ADR 0160), chat order, workspace moves and uploaded attachments also resolve through the caller.
    const carry = String.raw`undefined, leadRowCarry\(allowedLaunchers, homedir\(\)\)`;
    expect([...src.matchAll(new RegExp(String.raw`await caller\.resolve\((?:leadRows|${carry})?\);`, "g"))]).toHaveLength(37);
    expect([...src.matchAll(/await caller\.resolve\(leadRows\);/g)]).toHaveLength(1);
    expect([...src.matchAll(new RegExp(String.raw`await caller\.resolve\(${carry}\);`, "g"))]).toHaveLength(2);
    // Exactly twelve `registry.get(` calls remain, and each is a sanctioned one, named here rather
    // than exempted: assembling THIS collie's own snapshot body; `localRuntime`, the single
    // "(session) → runtime, or 404" helper both callers share; `/api/config`, which reports THIS
    // collie's own multiplexer (M10/06) and is not session-scoped at all; `/api/mux/logo.svg`,
    // which serves that same local multiplexer's mark and is session-scoped no more than the config
    // that publishes its URL; the attention stamp on `/api/snapshot`, which is a fact about
    // THIS collie's own engine on a route that is already local-body-then-merge and has no `?h=`
    // branch to fall through; and the crew surface's own `mux` source, which answers an admitted
    // LEAD with this machine's block on `hello` and is the same local read `/api/config` makes
    // (M22/03); and the cache-watch resolver, which turns `(host, session, paneId)` into the watch key
    // a PREFERENCE is stored under — deliberately NOT through the gate, because that preference belongs
    // on the collie the phone is talking to and a forward would store it on the machine that holds no
    // push subscription (ADR 0042, CREW_PROTOCOL.md §5). It reads a peer's pane out of the lead's own
    // swept body instead, exactly as `bridge/crew/notify.ts` does, and writes to no terminal at all;
    // and the hot intent after an input FORWARDED to a member, which tightens THIS collie's primary
    // engine because the sweep that brings the member's answer back rides its tick (CREW_PROTOCOL.md
    // §10.1). It runs after the forward has answered and writes nothing. Four more serve local agent
    // runs: two in their route (the primary-session check and the runtime behind it), and two when
    // attaching runs to the local primary snapshot (the check and its session name). These reads
    // explicitly refuse remote scope; a thirteenth would need its own justification.
    expect([...src.matchAll(/registry\.get\(/g)]).toHaveLength(12);
    expect(src).toContain('if (host.kind !== "local" || url.searchParams.has("host") || !registry.get(sessionName)?.isPrimary)');
    expect(src).toContain('if (opts.agentRuns && host.kind === "local" && registry.get(plan.local.session)?.isPrimary && !isLocalRequest(req, pairingGate))');
    // The mux read is a read of a LOCAL session (the primary unless `?session=` names one, M55), never
    // `?host=`, because a peer's capabilities are its own business and reach the lead over the crew
    // API, never out of this registry.
    expect(src).toContain("const activeMux = registry.get(sessionName);");
    // An unknown or ill-formed host is a 404, mirroring unknownSession() (§4)… The words now come
    // from the error catalogue (bridge/error-codes.ts), so what this pins is the SELECTION — that
    // both host shapes still name themselves in the refusal, and both still land on `host.unknown`.
    expect(src).toContain(
      'apiError("host.unknown", { host: host.kind === "member" ? host.id : host.raw })',
    );
    // …and a KNOWN peer is forwarded, with the peer's own response handed back (§5, §9.1). The
    // forward is the gate's own branch — no route may grow a second one.
    expect([...src.matchAll(/crewLead!\.forward\(/g)]).toHaveLength(1);
    expect(src).not.toContain("per-pane proxying is not implemented in this build");
  });

  test("a peer's own routes are the SAME closure the browser's are (§5), with two callers", () => {
    // The 1:1 rule: `/crew/v1/pane/:id/reply` and `/api/pane/:id/reply` are not two handlers that
    // agree — they are one block reached by two callers. Exactly one definition, exactly two calls.
    expect([...src.matchAll(/const serveSessionRoute = async/g)]).toHaveLength(1);
    expect([...src.matchAll(/serveSessionRoute\(\s*req/g)]).toHaveLength(2);
    // The peer's caller supplies its OWN gate and its OWN audit attribution — the lead's verdict is
    // never an input, and the write lands in the peer's log marked crew-originated (§12).
    expect(src).toContain("crewGate(level, cfg, device)");
    expect(src).toContain('audit.scoped({ via: "crew", from })');
  });

  test('"seen" is marked once, on the owning host, and never for a remote pane (.adr/0003)', () => {
    // One call site, and it sits AFTER the resolver — so a pane on a peer has already returned the
    // peer's forwarded response and cannot reach it. The peer marks it, against its own ledger,
    // because the `x-collie-seen` header is forwarded verbatim. Two machines counting one look would
    // be exactly the "one shared fact" ADR 0003 forbids.
    const calls = [...src.matchAll(/activity\.noteSeen\(/g)];
    expect(calls).toHaveLength(1);
    expect(src.indexOf("activity.noteSeen(")).toBeGreaterThan(src.indexOf("await caller.resolve();"));
    // And it is still keyed by (session, paneId) alone: the ledger's host dimension exists for the
    // LEAD's own bookkeeping, not for a peer marking its own panes (bridge/activity.ts).
    expect(src).toContain("activity.noteSeen(session, paneId)");
  });
});

// ── POST /api/update: the update write gate (M15/05) ────────────────────────────────────────────
//
// The route starts a real update, so its gate is the one thing about it that must not be its own.
// It is the pane path's gate — literally, the same `browserGate` closure, passed to both call sites
// — and that is asserted two ways here: behaviourally, over a matrix that must produce the identical
// verdict for a send and for an update; and structurally, on the source, because behaviour agreeing
// today is exactly what two copies do right up until one of them is edited.