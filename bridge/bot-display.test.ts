import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotDisplays, botDisplayChange } from "./bot-display.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "collie-bot-display-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const row = (paneId: string, host = "", session = "") => [host, session, paneId].join("\u0000");
const change = (paneId: string, view: "chat" | "terminal" = "chat", host = "", session = "") => ({ row: row(paneId, host, session), view });
const pane = (paneId: string, terminalId = paneId) => ({ paneId, terminalId });

describe("per-bot display preferences", () => {
  test("missing and corrupt files default to Messages and the next write repairs them", () => {
    expect(new BotDisplays(dir).read("local")).toEqual({ userId: "local", views: [] });
    for (const invalid of ["{", "null", '{"version":1,"users":{"local":{"bad":"chat"}}}',
      '{"version":1,"users":{"local":[]}}', '{"version":1,"users":{"local":{"\\u0000\\u0000w1:p1":"raw"}}}']) {
      writeFileSync(join(dir, "bot-display.json"), invalid);
      const store = new BotDisplays(dir);
      expect(store.read("local").views).toEqual([]);
      store.update("local", change("w1:p1"));
      expect(new BotDisplays(dir).read("local").views).toEqual([change("w1:p1")]);
    }
    expect(statSync(join(dir, "bot-display.json")).mode & 0o777).toBe(0o600);
  });

  test("one bot changes without replacing another bot or user", () => {
    const store = new BotDisplays(dir);
    store.update("a", change("w1:p1"));
    store.update("a", change("w1:p2", "terminal"));
    store.update("b", change("w1:p1", "terminal"));
    store.update("a", change("w1:p1", "terminal"));
    expect(new BotDisplays(dir).read("a").views).toEqual([change("w1:p1", "terminal"), change("w1:p2", "terminal")]);
    expect(new BotDisplays(dir).read("b").views).toEqual([change("w1:p1", "terminal")]);
  });

  test("a failed atomic replacement preserves the old state and leaves no temporary file", () => {
    mkdirSync(join(dir, "bot-display.json"));
    const store = new BotDisplays(dir);
    expect(() => store.update("local", change("w1:p1"))).toThrow();
    expect(store.read("local").views).toEqual([]);
    expect(readdirSync(dir)).toEqual(["bot-display.json"]);
  });

  test("a complete census clears deletion and trash but preserves peers and other sessions", () => {
    const store = new BotDisplays(dir);
    store.update("live", change("w1:p1"));
    store.update("trash", change("w1:p2"));
    store.update("gone", change("w1:p3"));
    store.update("peer", change("w1:p1", "chat", "peer"));
    store.update("session", change("w1:p1", "chat", "", "other"));
    store.reconcile("main", true, [pane("w1:p1"), pane("w1:p2")], candidate => candidate.paneId === "w1:p2");
    const loaded = new BotDisplays(dir);
    expect(loaded.read("live").views).toEqual([change("w1:p1")]);
    expect(loaded.read("trash").views).toEqual([]);
    expect(loaded.read("gone").views).toEqual([]);
    expect(loaded.read("peer").views).toEqual([change("w1:p1", "chat", "peer")]);
    expect(loaded.read("session").views).toEqual([change("w1:p1", "chat", "", "other")]);
  });

  test("the census clears only matching SSO rows", () => {
    using db = new Database(join(dir, "sso-owners.sqlite"), { create: true });
    db.run("CREATE TABLE settings(sub TEXT, name TEXT, value TEXT, PRIMARY KEY(sub,name))");
    db.run("INSERT INTO settings VALUES (?,?,?)", ["a", "bot-display:v1:" + row("w1:p1"), "chat"]);
    db.run("INSERT INTO settings VALUES (?,?,?)", ["b", "bot-display:v1:" + row("w1:p2"), "terminal"]);
    db.run("INSERT INTO settings VALUES (?,?,?)", ["c", "theme", "dark"]);
    new BotDisplays(dir, true).reconcile("main", true, [pane("w1:p2")], () => false);
    expect(db.query<{ name: string }, []>("SELECT name FROM settings WHERE name GLOB 'bot-display:v1:*'").all().map(setting => setting.name))
      .toEqual(["bot-display:v1:" + row("w1:p2")]);
    expect(db.query<{ value: string }, []>("SELECT value FROM settings WHERE name='theme'").get()?.value).toBe("dark");
  });

  test("only an exact row and view are accepted", () => {
    expect(botDisplayChange(JSON.stringify(change("w1:p1")))).toEqual(change("w1:p1"));
    for (const value of [{}, { row: "bad", view: "chat" }, { row: row("w1:p1"), view: "raw" },
      { ...change("w1:p1"), userId: "other" }, { row: row("w1:p1") }, { view: "chat" }]) {
      expect(botDisplayChange(JSON.stringify(value))).toBeUndefined();
    }
  });
});
