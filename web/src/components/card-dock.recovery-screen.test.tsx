import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardDock } from "./card-dock";
import { parseAnsi } from "@/lib/ansi";
import { splitLines } from "@/lib/blocks";

const lines = splitLines(parseAnsi("RECOVERY SCREEN CONTENT"));

describe("recovery cards share the terminal body", () => {
  it("keeps unread controls without drawing the visible terminal again", () => {
    const { rerender } = render(<CardDock blocks={[]} unreadFallback={lines} mirrorVisible onUnreadTypeAnyway={vi.fn()} />);
    expect(screen.queryByText("RECOVERY SCREEN CONTENT")).toBeNull();
    expect(screen.getByText("Collie cannot read this screen. You can.")).toBeInTheDocument();
    rerender(<CardDock blocks={[]} unreadFallback={lines} mirrorVisible={false} onUnreadTypeAnyway={vi.fn()} />);
    expect(screen.getByText("RECOVERY SCREEN CONTENT")).toBeInTheDocument();
  });

  it("keeps delivery confirmation controls without a second terminal", () => {
    const facts = { requestId: "unknown-1", secret: false, readOnly: false, awaitingUntil: null, interrupted: false };
    const cannotTell = { facts, lines, onArrived: vi.fn(async () => "recorded" as const), onClose: vi.fn(), onAgain: vi.fn() };
    const { rerender } = render(<CardDock blocks={[]} cannotTell={cannotTell} mirrorVisible />);
    expect(screen.queryByText("RECOVERY SCREEN CONTENT")).toBeNull();
    expect(screen.getByRole("button", { name: "It arrived" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send again" })).toBeInTheDocument();
    rerender(<CardDock blocks={[]} cannotTell={cannotTell} mirrorVisible={false} />);
    expect(screen.getByText("RECOVERY SCREEN CONTENT")).toBeInTheDocument();
  });
});
