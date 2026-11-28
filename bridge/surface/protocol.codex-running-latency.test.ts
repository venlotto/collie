import { expect, test } from "bun:test";
import { muxAck, type MuxAck } from "../mux/types.ts";
import { FakePane, rig, useScratchDir } from "./protocol.rig.ts";

useScratchDir();

for (const delay of ["probe", "backspace"] as const) {
  test(`Codex running: a late ${delay} is confirmed before the message is queued`, async () => {
    const clock = { now: 1_000_000 };
    const pane = new FakePane("codex");
    pane.over = ["• Working (3s • esc to interrupt)"];
    const paste = pane.pasteText;
    const keys = pane.writeKeys;
    let pending: (() => Promise<MuxAck>) | null = null;
    let due = Infinity;
    pane.pasteText = async (id, text) => {
      if (delay === "probe" && text === "⌁") {
        pending = () => paste(id, text); due = clock.now + 1200;
        return muxAck();
      }
      return paste(id, text);
    };
    pane.writeKeys = async (id, sent) => {
      if (delay === "backspace" && sent.includes("Backspace")) {
        pending = () => keys(id, sent); due = clock.now + 1200;
        return muxAck();
      }
      return keys(id, sent);
    };
    pane.beforeRead = async () => {
      if (pending !== null && clock.now >= due) { const run = pending; pending = null; await run(); }
    };
    const answer = await rig({ pane, clock, harness: "codex", version: "0.172.0" }).send("follow-up delivery check");
    expect(answer.receipt).toMatchObject({ outcome: "sent", queued: true });
    expect(pane.queued).toEqual(["follow-up delivery check"]);
    expect(pane.box).toBe("");
    expect(pane.keysSeen).not.toContain("Enter");
    expect(pane.keysSeen).not.toContain("Escape");
  });
}

test("a real 52-column waiting turn remains running when its interrupt hint is clipped", async () => {
  const { readFileSync } = await import("node:fs");
  const pane = new FakePane("codex");
  pane.fixed = readFileSync(new URL("./captures/codex--v0172-running-queue-clipped--w52.txt", import.meta.url), "utf8");
  const answer = await rig({ pane, harness: "codex", version: "0.172.0" }).send("", { mode: "prepare" });
  expect(answer.surface).toMatchObject({ turn: "running", composer: "empty", modal: "none" });
});
