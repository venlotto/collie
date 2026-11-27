import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { parseAnsi } from "@/lib/ansi";
import { splitLines } from "@/lib/blocks";
import { codexBuildBlocks } from "@/lib/harness/codex";
import { MenuBlock } from "./menu-block";

// Codex's reminder that a question waits (harness/codex/async-question.ts), off the real 0.172.0 capture:
// Collie's own words over the question the transcript printed, and one button that opens it.

const QUEUED = readFileSync(join(import.meta.dirname, "..", "fixtures", "panes", "codex--v0172-async-question--w52.txt"), "utf8");

function queuedBlock(capture = QUEUED) {
  const block = codexBuildBlocks(splitLines(parseAnsi(capture))).find((b) => b.kind === "menu");
  if (!block || block.kind !== "menu") throw new Error("the capture lifted no reminder card");
  return block;
}

describe("the queued-question card", () => {
  it("says a question waits, shows it, and its one button sends the key the row prints", async () => {
    const block = queuedBlock();
    const onAction = vi.fn();
    render(<MenuBlock menu={block.menu} lines={block.lines} onAction={onAction} />);
    expect(screen.getByText("The agent asked you a question")).toBeInTheDocument();
    expect(screen.getByText("Tabs or spaces?")).toBeInTheDocument();
    expect(screen.getByText("Tap Answer to see the options.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(onAction).toHaveBeenCalledWith({ keys: ["shift+Left"], nav: false });
  });

  it("holds the button while the box holds a draft", () => {
    const block = queuedBlock(QUEUED.replace("Ask Codex to do anything", "tabs please"));
    render(<MenuBlock menu={block.menu} lines={block.lines} onAction={vi.fn()} />);
    expect(block.menu.liveBox?.draft).toBe(true);
    expect(screen.getByRole("button", { name: "Answer" })).toBeDisabled();
  });
});
