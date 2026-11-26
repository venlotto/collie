import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/lib/api";
import { loadDraftEntry } from "@/lib/drafts";
import { markLive, resetLiveness } from "@/lib/liveness";
import { clearStatus } from "@/lib/status";
import { server } from "@/test/setup";
import { __resetOperatorCommands } from "@/lib/operator-config";
import { Composer } from "./composer";

// Exercise selecting media, keeping draft chips, and sending their uploaded paths.

beforeAll(() => {
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});
beforeEach(() => {
  __resetOperatorCommands();
  localStorage.clear();
  clearStatus();
  resetLiveness();
  markLive("w1:p1");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); __resetOperatorCommands(); });

function renderComposer(overrides: Partial<ComponentProps<typeof Composer>> = {}) {
  const props: ComponentProps<typeof Composer> = {
    paneId: "w1:p1",
    agent: "claude",
    isShell: false,
    gone: false,
    readOnly: false,
    surface: { revision: 1, turn: "idle", modal: "none", composer: "empty" },
    text: "pane output",
    terminalDraft: null,
    rawTerminalDraft: null,
    prefs: { wrap: true, fontSize: 11, draftFontSize: 14, chatFontSize: 14, fontFamily: "system", rawTerminal: false, tapToFocus: true, expandClippedReply: true, stretchText: false },
    display: { open: false, onToggle: vi.fn() },
    onSent: vi.fn(),
    ...overrides,
  };
  const router = createMemoryRouter([{ path: "/", element: <Composer {...props} /> }]);
  render(<RouterProvider router={router} />);
  return props;
}


describe("media attachments", () => {
  it("uploads selected videos, retains their chips, and sends their paths", async () => {
    const uploaded: string[] = [];
    const sent: string[] = [];
    server.use(
      http.get("/api/config", () => HttpResponse.json({ push: false, vapidPublicKey: "", upload: {
        maxBytes: 1024, imageTypes: ["png"], textTypes: ["txt"], videoTypes: ["mp4", "mov", "webm"],
      } })),
      http.post("/api/send", async ({ request }) => {
        // SAFETY: the real composer send client serialises its text in this request.
        sent.push((await request.json() as { text: string }).text);
        return HttpResponse.json({ receipt: { outcome: "sent", keys: [] }, offers: [] });
      }),
    );
    // jsdom Files do not serialise through Node's multipart encoder; test the upload boundary
    // with the original File, and keep the message send on the real API client.
    vi.spyOn(api, "uploadFile").mockImplementation(async (_paneId, file) => {
      uploaded.push(file.name);
      return { ok: true, path: `/tmp/${file.name}` };
    });
    renderComposer();
    await waitFor(() => expect(screen.getByLabelText("Videos")).toHaveAttribute("accept", ".mp4,.mov,.webm"));
    const openPicker = vi.spyOn(screen.getByLabelText("Videos"), "click").mockImplementation(() => {});
    await userEvent.click(screen.getByRole("button", { name: "Attach file" }));
    await userEvent.click(screen.getByRole("button", { name: "Videos" }));
    expect(openPicker).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("Videos"), { target: { files: [
      new File(["clip"], "first.mp4", { type: "video/mp4" }),
      new File(["clip"], "second.webm", { type: "video/webm" }),
    ] } });
    await waitFor(() => expect(loadDraftEntry(undefined, "w1:p1")?.attachments).toHaveLength(2));
    expect(uploaded).toEqual(["first.mp4", "second.webm"]);
    expect(screen.getByText("first.mp4")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toContain("/tmp/first.mp4");
    expect(sent[0]).toContain("/tmp/second.webm");
  });
});
