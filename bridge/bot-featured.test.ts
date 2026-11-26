import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotFeatured, botFeaturedChange } from "./bot-featured.ts";
import type { BotFeaturedPin } from "../web/src/lib/bot-featured-wire.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "collie-bot-featured-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const pin = (paneId: string, space = "Proyectos", host = "", session = "", at = 1): BotFeaturedPin => ({
  row: [host, session, paneId].join("\u0000"), space, at,
});
const pane = (paneId: string, workspaceLabel = "Proyectos", terminalId = "terminal-1") => ({ paneId, workspaceLabel, terminalId });

describe("the single featured-chat preference", () => {
  test("missing and corrupt files mean no slot, and the next choice repairs the file", () => {
    expect(new BotFeatured(dir).read("local")).toEqual({ userId: "local", featured: null });
    for (const invalid of ["{", "null", '{"version":1,"users":{"local":{"row":"bad"}}}']) {
      writeFileSync(join(dir, "bot-featured.json"), invalid);
      const store = new BotFeatured(dir);
      expect(store.read("local").featured).toBeNull();
      store.update("local", pin("w1:p1"));
      expect(new BotFeatured(dir).read("local").featured).toEqual(pin("w1:p1"));
    }
    expect(statSync(join(dir, "bot-featured.json")).mode & 0o777).toBe(0o600);
  });

  test("pinning B replaces A, unpinning empties the slot, and users stay isolated", () => {
    const store = new BotFeatured(dir);
    store.update("sso:A", pin("w1:p1"));
    store.update("sso:A", pin("w1:p2", "Proyectos", "", "", 2));
    store.update("sso:B", pin("w1:p1"));
    expect(new BotFeatured(dir).read("sso:A").featured).toEqual(pin("w1:p2", "Proyectos", "", "", 2));
    expect(new BotFeatured(dir).read("sso:B").featured).toEqual(pin("w1:p1"));
    store.update("sso:A", null);
    expect(new BotFeatured(dir).read("sso:A").featured).toBeNull();
    expect(new BotFeatured(dir).read("sso:B").featured).toEqual(pin("w1:p1"));
  });

  test("a failed atomic replacement preserves the old state and leaves no temporary file", () => {
    mkdirSync(join(dir, "bot-featured.json"));
    const store = new BotFeatured(dir);
    expect(() => store.update("local", pin("w1:p1"))).toThrow();
    expect(store.read("local").featured).toBeNull();
    expect(readdirSync(dir)).toEqual(["bot-featured.json"]);
  });

  test("a complete census clears trash, deletion and id reuse but preserves peers and other sessions", () => {
    const store = new BotFeatured(dir);
    store.update("live", pin("w1:p1"));
    store.update("trashed", pin("w1:p2"));
    store.update("gone", pin("w1:p3"));
    store.update("reused", pin("w1:p4", "Otro workspace"));
    store.update("peer", pin("w1:p9", "Proyectos", "peer"));
    store.update("session", pin("w1:p9", "Proyectos", "", "other"));
    const panes = [pane("w1:p1"), pane("w1:p2", "Proyectos", "terminal-2"), pane("w1:p4", "Proyectos", "terminal-4")];
    store.reconcile("main", true, panes, candidate => candidate.terminalId === "terminal-2");
    const loaded = new BotFeatured(dir);
    expect(loaded.read("live").featured).toEqual(pin("w1:p1"));
    expect(loaded.read("trashed").featured).toBeNull();
    expect(loaded.read("gone").featured).toBeNull();
    expect(loaded.read("reused").featured).toBeNull();
    expect(loaded.read("peer").featured).toEqual(pin("w1:p9", "Proyectos", "peer"));
    expect(loaded.read("session").featured).toEqual(pin("w1:p9", "Proyectos", "", "other"));
  });

  test("a workspace move clears the SSO setting too, without touching another subject's pin", () => {
    using db = new Database(join(dir, "sso-owners.sqlite"), { create: true });
    db.run("CREATE TABLE settings(sub TEXT, name TEXT, value TEXT, PRIMARY KEY(sub,name))");
    db.run("INSERT INTO settings VALUES (?,?,?)", ["a", "bot-featured:v1", JSON.stringify(pin("w1:p1", "Antiguo"))]);
    db.run("INSERT INTO settings VALUES (?,?,?)", ["b", "bot-featured:v1", JSON.stringify(pin("w1:p1", "Proyectos"))]);
    db.run("INSERT INTO settings VALUES (?,?,?)", ["c", "theme", "dark"]);
    new BotFeatured(dir, true).reconcile("main", true, [pane("w1:p1")], () => false);
    expect(db.query<{ sub: string }, []>("SELECT sub FROM settings WHERE name='bot-featured:v1'").all().map(row => row.sub)).toEqual(["b"]);
    expect(db.query<{ sub: string }, []>("SELECT sub FROM settings WHERE name='theme'").all().map(row => row.sub)).toEqual(["c"]);
  });

  test("only one well-formed featured value is accepted", () => {
    expect(botFeaturedChange(JSON.stringify({ featured: pin("w1:p1") }))).toEqual({ featured: pin("w1:p1") });
    expect(botFeaturedChange(JSON.stringify({ featured: null }))).toEqual({ featured: null });
    for (const value of [{}, { featured: undefined }, { featured: "w1:p1" }, { featured: { ...pin("w1:p1"), row: "bad" } },
      { featured: pin("w1:p1"), userId: "other" }, { featured: { ...pin("w1:p1"), at: -1 } }]) {
      expect(botFeaturedChange(JSON.stringify(value))).toBeUndefined();
    }
  });
});
