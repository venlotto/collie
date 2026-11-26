import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UiSections, sectionChanges } from "./ui-sections.ts";

let dir: string;
const section = (id: string, session: string | null = null, host: string | null = null) => JSON.stringify([host, session, id]);
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "collie-ui-sections-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("workspace accordion preferences", () => {
  test("missing and corrupt ledgers open all sections, and the next toggle can repair them", () => {
    expect(new UiSections(dir).read("local")).toEqual({ userId: "local", folded: [] });
    for (const invalid of ["{", '{"version":1,"users":{"a":["trash"],"b":[false]}}', "null"]) {
      writeFileSync(join(dir, "ui-sections.json"), invalid);
      const store = new UiSections(dir);
      expect(store.read("a").folded).toEqual([]);
      store.update("a", new Map([["trash", true]]));
      expect(new UiSections(dir).read("a").folded).toEqual(["trash"]);
    }
    expect(statSync(join(dir, "ui-sections.json")).mode & 0o777).toBe(0o600);
  });

  test("an unreadable ledger leaves the list usable and a failed replacement keeps the old state", () => {
    mkdirSync(join(dir, "ui-sections.json"));
    const store = new UiSections(dir);
    expect(store.read("local").folded).toEqual([]);
    expect(() => store.update("local", new Map([["trash", true]]))).toThrow();
    expect(store.read("local").folded).toEqual([]);
    expect(readdirSync(dir)).toEqual(["ui-sections.json"]);
  });

  test("merges per-section device changes, scopes them by subject and persists re-opening", () => {
    const store = new UiSections(dir);
    const one = section("w1");
    const two = section("w2");
    store.update("sso:A", new Map([[one, true], ["trash", true]]));
    store.update("sso:B", new Map([[one, true]]));
    store.update("sso:A", new Map([[two, true], [one, false]]));
    const loaded = new UiSections(dir);
    expect(loaded.read("sso:A").folded).toEqual(["trash", two]);
    expect(loaded.read("sso:B").folded).toEqual([one]);
    expect(loaded.read("local").folded).toEqual([]);
    const file = join(dir, "ui-sections.json");
    const unchanged = statSync(file).ino;
    loaded.update("sso:A", new Map([[two, true]]));
    expect(statSync(file).ino).toBe(unchanged);
  });

  test("rename and move keep the stable id, trash keeps recoverable workspaces, permanent deletion reaps all owners", () => {
    const store = new UiSections(dir);
    const keys = ["trash", section("keep"), section("purge"), section("purge", "main"), section("purge", "other"), section("purge", null, "peer")];
    for (const user of ["a", "b"]) store.update(user, new Map(keys.map(key => [key, true])));
    const groups = [{ id: "purge", name: "Original" }, { id: "keep", name: "Otra" }];
    groups.reverse();
    groups[0]!.name = "Cambiado";
    store.reconcile("main", true, new Set(groups.map(g => g.id)), () => false);
    expect(store.read("a").folded).toEqual(keys);
    store.reconcile("main", true, new Set(["keep"]), id => id === "purge");
    expect(store.read("b").folded).toEqual(keys);
    store.reconcile("main", true, new Set(["keep"]), () => false);
    const expected = ["trash", section("keep"), section("purge", "other"), section("purge", null, "peer")];
    for (const user of ["a", "b"]) expect(new UiSections(dir).read(user).folded).toEqual(expected);
  });

  test("rejects user selection, malformed deltas, arbitrary keys and ambiguous section IDs", () => {
    const one = section("w1");
    expect(sectionChanges(JSON.stringify({ changes: { [one]: true, trash: false } }))).toEqual(new Map([[one, true], ["trash", false]]));
    for (const data of [{ userId: "b", changes: {} }, { changes: [] }, { changes: { trash: "false" } },
      { changes: { "w1": true } }, { changes: { '[null,null,"w1",1]': true } }, { changes: { '[{},null,"w1"]': true } }]) {
      expect(sectionChanges(JSON.stringify(data))).toBeUndefined();
    }
  });

  test("reaps only section settings in the SSO store for the purged workspace and confirmed session", () => {
    using db = new Database(join(dir, "sso-owners.sqlite"), { create: true });
    db.run("CREATE TABLE settings(sub TEXT, name TEXT, value TEXT, PRIMARY KEY(sub,name))");
    const prefix = "bot-section:v1:";
    const names = [prefix + section("gone"), prefix + section("rescued"), prefix + section("gone", "elsewhere"), prefix + "trash", "collie:theme:v1"];
    for (const sub of ["a", "b"]) {
      for (const name of names) db.run("INSERT INTO settings VALUES (?,?,?)", [sub, name, "1"]);
    }
    new UiSections(dir, true).reconcile("primary", true, new Set(), id => id === "rescued");
    for (const sub of ["a", "b"]) {
      const rows = db.query<{ name: string }, [string]>("SELECT name FROM settings WHERE sub=? ORDER BY name").all(sub);
      expect(rows.map(row => row.name)).toEqual(names.slice(1).toSorted());
    }
  });
});
