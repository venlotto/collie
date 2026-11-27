import { test, expect } from "bun:test";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { AuditLog } from "./audit.ts";
import { requestBodyCap, uploadPane } from "./server.ts";
import { crewRouteFor, forwardKind, streamsToPhone } from "./crew/forward.ts";

test("real multipart HTTP accepts 8 MiB and rejects over 10 MiB without a mux or live bridge", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "collie-upload-http-"));
  const cfg = loadConfig({ COLLIE_STATE_DIR: stateDir }, () => false, () => []);
  const audit = new AuditLog(async () => {});
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: requestBodyCap(cfg),
    fetch: req => uploadPane(cfg, "fixture", req, audit, null, "fixture") });
  try {
    for (const mb of [8, 11]) {
      const bytes = new Uint8Array(mb * 1024 * 1024); bytes.set([137,80,78,71,13,10,26,10]);
      const form = new FormData(); form.append("file", new File([bytes], "photo.png", { type: "image/png" }));
      const response = await fetch(server.url, { method: "POST", body: form });
      const result = await response.json();
      expect(result.ok).toBe(mb === 8);
      if (mb === 8) expect((await readFile(result.path)).byteLength).toBe(bytes.length);
      else { expect(response.status).toBe(413); expect(result.code).toBe("upload.too_large"); }
    }
    expect((await readdir(join(stateDir, "uploads"))).filter(name => !name.endsWith(".json"))).toHaveLength(1);
  } finally { server.stop(true); await rm(stateDir, { recursive: true, force: true }); }
});
test("attachment metadata and bytes are GET-only crew reads", () => {
  for (const suffix of ["", "/image"]) {
    const route = "attachments/term.fixture.mwz50y8g-12345678.png" + suffix;
    expect(crewRouteFor("/api/" + route, "GET")).toBe(route);
    expect(crewRouteFor("/api/" + route, "POST")).toBeNull();
    expect(forwardKind(route)).toBe("read");
    expect(streamsToPhone(route)).toBe(suffix !== "");
  }
});
