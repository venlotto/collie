import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotTrash, botUploadPrefix, TRASH_RETENTION } from "./bot-trash.ts";
import { HerdrMux } from "./mux/herdr/adapter.ts";
import { FakeHerdr } from "./mux/herdr/fixture.ts";

async function world() {
  const dir = mkdtempSync(join(tmpdir(), "collie-test-trash-"));
  const mux = new HerdrMux(new FakeHerdr(), () => []);
  const rt = { herdr: mux, engine: { pokeNow() {} } };
  let now = 123456789;
  const load = () => new BotTrash(dir, () => rt, () => now);
  const terminals = (await mux.snapshot()).panes;
  return { dir, mux, load, trash: load(), a: terminals[0]!, b: terminals[1]!, advance(ms: number) { now += ms; },
    close() { rmSync(dir, { recursive: true, force: true }); } };
}

describe("server trash, fixture mux and simulated clock", () => {
  test("restart, expiry boundary, scoped file cleanup and unrelated panes", async () => {
    const w = await world();
    try {
      const id = w.a.terminalId!;
      await w.trash.act("one", "trash", id);
      const restart = w.load();
      expect(restart.lookup("one", id)).toEqual(w.trash.lookup("one", id));
      const uploads = join(w.dir, "uploads");
      mkdirSync(uploads);
      const owned = join(uploads, botUploadPrefix("one", id) + "image.png");
      const other = join(uploads, botUploadPrefix("two", id) + "image.png");
      writeFileSync(owned, "one"); writeFileSync(other, "two");
      w.advance(TRASH_RETENTION - 1);
      await restart.sweep();
      expect(existsSync(owned)).toBe(true);
      expect((await w.mux.snapshot()).panes.some(p => p.terminalId === id)).toBe(true);
      w.advance(1);
      await restart.sweep();
      expect((await w.mux.snapshot()).panes.some(p => p.terminalId === id)).toBe(false);
      expect((await w.mux.snapshot()).panes.some(p => p.terminalId === w.b.terminalId)).toBe(true);
      expect(existsSync(owned)).toBe(false);
      expect(existsSync(other)).toBe(true);
      expect(existsSync(join(w.dir, "bot-trash.json"))).toBe(false);
    } finally { w.close(); }
  });

  test("restoring cancels expiry and stale deletion requests", async () => {
    const w = await world();
    try {
      const id = w.a.terminalId!;
      await expect(w.trash.act("one", "purge", id)).rejects.toThrow();
      await w.trash.act("one", "trash", id);
      const first = w.trash.lookup("one", id)!.trashedAt;
      await w.trash.act("one", "restore", id, undefined, first);
      w.advance(TRASH_RETENTION);
      await w.trash.sweep();
      await w.trash.act("one", "trash", id);
      await expect(w.trash.act("one", "purge", id, undefined, first)).rejects.toThrow();
      expect((await w.mux.snapshot()).panes.some(p => p.terminalId === id)).toBe(true);
    } finally { w.close(); }
  });

  test("failed file cleanup resumes after restart even if a new pane uses the old address", async () => {
    const w = await world();
    try {
      const id = w.a.terminalId!;
      await w.trash.act("one", "trash", id);
      const uploads = join(w.dir, "uploads");
      mkdirSync(uploads);
      const blocked = join(uploads, botUploadPrefix("one", id) + "busy");
      mkdirSync(blocked);
      await expect(w.trash.act("one", "purge", id, undefined, w.trash.lookup("one", id)!.trashedAt)).rejects.toThrow();
      expect((await w.mux.snapshot()).panes.some(p => p.terminalId === id)).toBe(false);
      rmSync(blocked, { recursive: true });
      // A restarted Herdr fixture mints the same numeric addresses. Give the replacement
      // a different terminal identity, as the real mux does.
      const replacement = new HerdrMux(new FakeHerdr(), () => []);
      const snapshot = replacement.snapshot.bind(replacement);
      replacement.snapshot = async () => {
        const current = await snapshot();
        return { ...current, panes: current.panes.map(p => Object.assign({}, p, { terminalId: "new-" + p.terminalId })) };
      };
      const restart = new BotTrash(w.dir, () => ({ herdr: replacement, engine: { pokeNow() {} } }));
      await restart.sweep();
      expect(restart.lookup("one", id)).toBeUndefined();
      expect((await replacement.snapshot()).panes.some(p => p.paneId === w.a.paneId)).toBe(true);
    } finally { w.close(); }
  });
});
