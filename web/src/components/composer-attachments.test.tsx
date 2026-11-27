import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { http, HttpResponse, delay } from "msw";
import { server } from "@/test/setup";
import { Composer } from "./composer";
import { __resetOperatorCommands } from "@/lib/operator-config";
import { clearStatus } from "@/lib/status";
import { setLocale, whenLocaleReady } from "@/lib/i18n";
vi.mock("@/lib/liveness", async original => ({ ...await original<typeof import("@/lib/liveness")>(), useLive: () => true, isLive: () => true }));
vi.mock("@/lib/image-edit", async original => ({ ...await original<typeof import("@/lib/image-edit")>(), canvasAvailable: () => true }));
vi.mock("./image-editor", () => ({ ImageEditor: ({ file, onConfirm }: { file: File; onConfirm: (file: File) => void }) =>
  <button onClick={() => onConfirm(file)}>Confirm photo</button> }));

beforeEach(async () => {
  vi.restoreAllMocks();
  clearStatus(); __resetOperatorCommands(); setLocale("en"); await whenLocaleReady();
  server.use(http.get("/api/config", () => HttpResponse.json({ push: false, vapidPublicKey: "", upload: {
    maxBytes: 10 * 1024 * 1024, imageTypes: ["png"], textTypes: ["txt"],
  } })));
});
function open() {
  const router = createMemoryRouter([{ path: "/", element: <Composer paneId="fixture" agent="claude" isShell={false}
    gone={false} readOnly={false} surface={{ revision: 1, turn: "idle", modal: "none", composer: "empty" }}
    text="" terminalDraft={null} rawTerminalDraft={null} onSent={vi.fn()}
    prefs={{ wrap: true, fontSize: 11, draftFontSize: 14, chatFontSize: 14, fontFamily: "system", rawTerminal: false,
      tapToFocus: true, expandClippedReply: true, stretchText: false }} display={{ open: false, onToggle: vi.fn() }} /> }]);
  return render(<RouterProvider router={router} />);
}
it("does not consume a bot/workspace reorder drag", () => {
  const { container } = open();
  const box = container.querySelector('[data-slot="composer-box"]')!;
  expect(fireEvent.dragOver(box, { dataTransfer: { types: ["text/plain"] } })).toBe(true);
  expect(fireEvent.drop(box, { dataTransfer: { types: ["text/plain"], files: [] } })).toBe(true);
});
it("a dropped image uses the editor; a second drop cannot replace its pending promise", async () => {
  const { container } = open();
  server.use(http.post(/\/upload$/, () => HttpResponse.json({ ok: true, path: "/tmp/photo.png" })));
  const box = container.querySelector('[data-slot="composer-box"]')!;
  const drop = (name: string) => fireEvent.drop(box, { dataTransfer: { types: ["Files"], files: [new File(["png"], name, { type: "image/png" })] } });
  expect(drop("first.png")).toBe(false);
  await screen.findByText("Confirm photo");
  drop("second.png");
  fireEvent.click(screen.getByText("Confirm photo"));
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("[Image #1] "));
  expect(screen.queryByText("Confirm photo")).toBeNull();
});
it("a timed-out 8 MiB upload shows an error and releases Attach", async () => {
  const { container } = open();
  server.use(http.post(/\/upload$/, async () => { await delay("infinite"); return HttpResponse.json({ ok: true, path: "/tmp/late.png" }); }));
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => realTimeout(ms === 60_000 ? 20 : ms));
  fireEvent.change(container.querySelector('input[accept="image/*"]')!, { target: { files: [new File([new Uint8Array(8 * 1024 * 1024)], "large.png", { type: "image/png" })] } });
  fireEvent.click(await screen.findByText("Confirm photo"));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/timeout|timed out|aborted/i));
  await waitFor(() => expect(screen.getByRole("button", { name: "Attach file" })).toBeEnabled());
});
it("confirms an 8 MiB image without re-encoding its bytes", async () => {
  const api = await import("@/lib/api");
  const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({ ok: true, path: "/tmp/large.png" });
  const { container } = open();
  const file = new File([new Uint8Array(8 * 1024 * 1024)], "large.png", { type: "image/png" });
  fireEvent.change(container.querySelector('input[accept="image/*"]')!, { target: { files: [file] } });
  fireEvent.click(await screen.findByText("Confirm photo"));
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("[Image #1] "));
  expect(upload.mock.calls[0]?.[1]).toBe(file);
  expect(upload.mock.calls[0]?.[1].size).toBe(8 * 1024 * 1024);
});
it("a later success in a multi-file drop does not erase the earlier failure", async () => {
  const { container } = open();
  let attempt = 0;
  server.use(http.post(/\/upload$/, () => ++attempt === 1
    ? new HttpResponse(null, { status: 502 }) : HttpResponse.json({ ok: true, path: "/tmp/good.png" })));
  fireEvent.drop(container.querySelector('[data-slot="composer-box"]')!, { dataTransfer: {
    types: ["Files"], files: ["bad.png", "good.png"].map(name => new File(["png"], name, { type: "image/png" })),
  } });
  fireEvent.click(await screen.findByText("Confirm photo"));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("bad.png"));
  fireEvent.click(await screen.findByText("Confirm photo"));
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("[Image #1] "));
  expect(screen.getByRole("alert")).toHaveTextContent("Bad Gateway");
  expect(screen.getByRole("alert")).toHaveTextContent("bad.png");
});
it("drops a text file directly as a File chip without opening the image editor", async () => {
  const { container } = open();
  server.use(http.post(/\/upload$/, () => HttpResponse.json({ ok: true, path: "/tmp/nota.txt" })));
  await waitFor(() => expect(container.querySelector('input[data-testid="attach-files"]')).toHaveAttribute("accept", expect.stringContaining(".txt")));
  fireEvent.drop(container.querySelector('[data-slot="composer-box"]')!, { dataTransfer: {
    types: ["Files"], files: [new File(["nota"], "nota.txt", { type: "text/plain" })],
  } });
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("[File #1] "));
  expect(screen.queryByText("Confirm photo")).toBeNull();
});
