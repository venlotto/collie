import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { BotActivity, botRowKind, groupBotTurns } from "./bot-activity";
import type { ChatItem } from "@/lib/chat-items";

const reply = (id: string, text: string): Extract<ChatItem, { kind: "reply" }> => ({ id, kind: "reply", text });
const user: ChatItem = { id: "user", kind: "user", text: "Check the build" };
const step: ChatItem = { id: "step", kind: "tool", status: "running", tool: { kind: "execute", command: "bun run build" } };
const progress = reply("progress", "Checking the build now");
const answer = reply("answer", "The build passed");
const turns = (items: ChatItem[]) => [{ user: true, items: [user] }, { user: false, items }];

it("folds live prose with steps, then keeps the finished answer outside", () => {
  const live = groupBotTurns(turns([progress, step, answer]), true);
  expect(live.blocks.map(group => group.map(item => item.id))).toEqual([["user"], ["progress", "step", "answer"]]);
  expect(botRowKind(live.blocks[1]![0]!)).toBe("activity");
  const done = groupBotTurns(turns([progress, { ...step, status: "done" }, answer]), false);
  expect(done.blocks.map(group => group.map(item => item.id))).toEqual([["user"], ["progress", "step"], ["answer"]]);
  expect(botRowKind(done.blocks[2]![0]!)).toBe("reply");
  expect(progress).not.toHaveProperty("intermediate");
});

it("starts closed and preserves the reader's choice across incoming steps and completion", () => {
  const view = render(<BotActivity items={[progress]} />);
  expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText(progress.text)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText(progress.text)).toBeVisible();
  view.rerender(<BotActivity items={[progress, reply("next", "Running checks")]} />);
  expect(screen.getByText("Running checks")).toBeVisible();
  const collapse = screen.getByRole("button", { name: "Collapse" });
  expect(screen.getByText("Running checks").compareDocumentPosition(collapse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(collapse);
  expect(screen.getByRole("button")).toHaveFocus();
  view.rerender(<BotActivity items={[progress, reply("next", "Checks complete")]} />);
  expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("Checks complete")).not.toBeInTheDocument();
});

it("keeps previous answers visible and starts a separate fold after a new prompt", () => {
  const result = groupBotTurns([
    ...turns([progress, step, answer]),
    { user: true, items: [{ ...user, id: "user2" }] },
    { user: false, items: [reply("progress2", "Checking again")] },
  ], true);
  expect(result.blocks.map(group => group.map(item => item.id))).toEqual([
    ["user"], ["progress", "step"], ["answer"], ["user2"], ["progress2"],
  ]);
});

it("keeps errors and questions outside the activity section", () => {
  const failed: ChatItem = { ...step, id: "failed", status: "failed" };
  const question: ChatItem = { id: "question", kind: "tool", status: "running", tool: { kind: "question", name: "AskUserQuestion", summary: "Choose", questions: [] } };
  const result = groupBotTurns(turns([progress, failed, question, step]), true);
  expect(result.blocks.map(group => group.map(item => item.id))).toEqual([["user"], ["progress", "step"], ["failed"], ["question"]]);
});
