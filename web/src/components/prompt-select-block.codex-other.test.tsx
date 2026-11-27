import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAnsi } from "@/lib/ansi";
import { splitLines, type PromptModel } from "@/lib/blocks";
import { detectAsyncPanel } from "@/lib/harness/codex/async-question";
import { markLive, resetLiveness } from "@/lib/liveness";
import { PromptSelectBlock, type PromptBlockAction } from "./prompt-select-block";

// Codex's `Other` answer typed from the card and not sent (a 23-row pane, captures of 2026-11-27): the
// words wait in the terminal's field, and the card says so and offers to send them again, for as long
// as the field shows exactly the words this card typed.
const PANES_DIR = join(import.meta.dirname, "..", "fixtures", "panes");
function model(name: string): PromptModel {
  const region = detectAsyncPanel(splitLines(parseAnsi(readFileSync(join(PANES_DIR, name), "utf8"))));
  if (region === null) throw new Error(`fixture ${name} did not detect`);
  return region.model;
}
const OPENED = model("codex--v0172-async-two-panel-23rows--w52.txt");
const TYPED = model("codex--v0172-async-other-typed-23rows--w52.txt");
const TEXT = "Fish 42, maybe 3";
const STRANDED = /Your answer did not go out/;

afterEach(() => resetLiveness());

async function failOnce(paneId: string, onAction: (action: PromptBlockAction) => boolean) {
  markLive(paneId);
  const user = userEvent.setup();
  const view = render(<PromptSelectBlock prompt={OPENED} paneId={paneId} onAction={onAction} />);
  await user.click(screen.getByRole("button", { name: "Type your own answer" }));
  await user.type(screen.getByRole("textbox", { name: "Answer text" }), TEXT);
  await user.click(screen.getByRole("button", { name: "Send answer" }));
  return { user, view };
}

describe("PromptSelectBlock — a Codex `Other` answer that did not go", () => {
  it("names the words left in the field, keeps the answers locked, and sends them again on a tap", async () => {
    const onAction = vi.fn<(action: PromptBlockAction) => boolean>().mockReturnValueOnce(false).mockReturnValue(true);
    const { user, view } = await failOnce("w1:other-a", onAction);
    view.rerender(<PromptSelectBlock prompt={TYPED} paneId="w1:other-a" onAction={onAction} />);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent(STRANDED);
    expect(notice).toHaveTextContent(TEXT);
    expect(screen.getByRole("button", { name: /Cat/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Send it again" }));
    expect(onAction).toHaveBeenLastCalledWith({ kind: "confirm-feedback", text: TEXT });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("survives a remount of the card (the person left the chat and came back)", async () => {
    const { view } = await failOnce("w1:other-b", () => false);
    view.unmount();
    render(<PromptSelectBlock prompt={TYPED} paneId="w1:other-b" onAction={() => true} />);
    expect(screen.getByRole("alert")).toHaveTextContent(STRANDED);
  });

  it("says nothing when the field holds other words than the ones this card typed", async () => {
    const { view } = await failOnce("w1:other-c", () => false);
    const other = { ...TYPED, feedback: { ...TYPED.feedback!, text: "Fish" } };
    view.rerender(<PromptSelectBlock prompt={other} paneId="w1:other-c" onAction={() => true} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send it again" })).toBeNull();
  });

  it("offers nothing to resend for words this card never typed", () => {
    markLive("w1:other-d");
    render(<PromptSelectBlock prompt={TYPED} paneId="w1:other-d" onAction={() => true} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send it again" })).toBeNull();
  });
});
