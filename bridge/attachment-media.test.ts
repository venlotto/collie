import { test, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachmentResponse, saveAttachmentName } from "./attachment-media.ts";
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function rig() {
  const root = await mkdtemp(join(tmpdir(), "collie-attachment-")); dirs.push(root);
  const dir = join(root, "uploads"); await mkdir(dir);
  const name = "term.fixture.mwz50y8g-12345678.png";
  const png = new Uint8Array(8 * 1024 * 1024); png.set([137,80,78,71,13,10,26,10]);
  await writeFile(join(dir, name), png);
  return { root, dir, name, png };
}
test("8 MiB image and original name survive a fresh reader; old uploads fall back to saved name", async () => {
  const { dir, name, png } = await rig();
  expect(await (await attachmentResponse(dir, name, false, 10 * 1024 * 1024)).json()).toEqual({ name, image: true });
  await saveAttachmentName(dir, name, "photo-small.png");
  expect(await (await attachmentResponse(dir, name, false, 10 * 1024 * 1024)).json()).toEqual({ name: "photo-small.png", image: true });
  const image = await attachmentResponse(dir, name, true, 10 * 1024 * 1024);
  expect(image.headers.get("content-type")).toBe("image/png");
  expect(image.headers.get("cache-control")).toContain("no-store");
  expect((await image.arrayBuffer()).byteLength).toBe(png.length);
  expect((await attachmentResponse(dir, name, true, 7 * 1024 * 1024)).status).toBe(404);
});
test("names are looked up, traversal and links outside uploads are refused, text is never served as HTML", async () => {
  const { root, dir, name } = await rig();
  for (const bad of ["../secret", "%2e%2e%2fsecret", "missing.png", "/etc/passwd"]) {
    expect((await attachmentResponse(dir, bad, true, 10e6)).status).toBe(404);
  }
  await writeFile(join(root, "secret"), "private");
  await rm(join(dir, name)); await symlink(join(root, "secret"), join(dir, name));
  expect((await attachmentResponse(dir, name, true, 10e6)).status).toBe(404);
  await writeFile(join(dir, "w1_p1-mwz50y8g-12345678.txt"), "hello");
  await saveAttachmentName(dir, "w1_p1-mwz50y8g-12345678.txt", "nota.txt");
  expect(await (await attachmentResponse(dir, "w1_p1-mwz50y8g-12345678.txt", false, 10e6)).json()).toEqual({ name: "nota.txt", image: false });
  expect((await attachmentResponse(dir, "w1_p1-mwz50y8g-12345678.txt", true, 10e6)).status).toBe(404);
});
