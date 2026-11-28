// Read uploaded media by a name LISTED in the bridge's own uploads directory, never by a client
// path. Like operator fonts, lookup precedes path construction; real-path containment is a second
// independent check. Names are server-minted, and original display names are inert JSON sidecars.
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { containedRealpath } from "./journal/files.ts";
import { imageExtFromBytes } from "./uploads.ts";
import { asJsonString, parseJsonObject } from "../web/src/lib/json.ts";

export const ATTACHMENT_NAME = /^[A-Za-z0-9_.-]+-[0-9a-f]{8}\.[a-z0-9]+$/;
const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox" };
export async function saveAttachmentName(uploadsDir: string, saved: string, name: string): Promise<void> {
  await writeFile(join(uploadsDir, saved + ".name.json"), JSON.stringify({ name: name.slice(0, 255) }), { mode: 0o600 });
}
export async function attachmentResponse(dir: string, id: string, image: boolean, maxBytes: number): Promise<Response> {
  const missing = () => new Response("Attachment unavailable", { status: 404, headers: HEADERS });
  if (!ATTACHMENT_NAME.test(id)) return missing();
  try {
    const names = await readdir(dir);
    const listed = names.find(name => name === id);
    if (listed === undefined) return missing();
    const path = await containedRealpath(join(dir, listed), dir);
    if (path === null) return missing();
    const info = await stat(path);
    if (!info.isFile() || info.size > maxBytes) return missing();
    const file = Bun.file(path);
    const ext = imageExtFromBytes(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
    if (image) {
      if (ext === null) return missing();
      return new Response(file, { headers: { ...HEADERS, "content-type": `image/${ext === "jpg" ? "jpeg" : ext}` } });
    }
    let name = listed;
    const sidecar = names.find(row => row === listed + ".name.json");
    if (sidecar !== undefined) {
      const metaPath = await containedRealpath(join(dir, sidecar), dir);
      if (metaPath !== null && (await stat(metaPath)).size <= 2048) {
        const stored = asJsonString(parseJsonObject(await readFile(metaPath, "utf8"))?.name);
        if (stored) name = stored;
      }
    }
    return Response.json({ name, image: ext !== null }, { headers: HEADERS });
  } catch {
    return missing();
  }
}
