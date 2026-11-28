import { act, fireEvent, render, screen } from "@testing-library/react";
import { clearAllDrafts, clearDraft, loadDraft, saveDraft } from "@/lib/drafts";
import { BotDeskReply } from "./bot-desk-reply";

beforeEach(() => clearAllDrafts());

it("shows the saved unsent text after leaving a chat, and focusing never clears it", () => {
  const text = "Primera línea\n\nSegunda parte del mensaje";
  saveDraft(undefined, "w1:p1", text);
  const onReply = vi.fn();
  render(<BotDeskReply paneId="w1:p1" scope={{}} placeholder="Ask Ardilla…" onReply={onReply} />);
  expect(screen.getByText(text, { normalizer: value => value })).toBeVisible();
  expect(screen.queryByText("Ask Ardilla…")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button"));
  expect(onReply).toHaveBeenCalledOnce();
  expect(loadDraft(undefined, "w1:p1")).toBe(text);
});

it("follows a pending send's returned draft and its later clear without mixing panes", () => {
  render(<BotDeskReply paneId="w1:p1" scope={{}} placeholder="Ask Ardilla…" onReply={() => {}} />);
  act(() => saveDraft(undefined, "w1:p2", "another bot"));
  expect(screen.getByText("Ask Ardilla…")).toBeVisible();
  act(() => saveDraft(undefined, "w1:p1", "typed but not submitted"));
  expect(screen.getByText("typed but not submitted")).toBeVisible();
  act(() => saveDraft(undefined, "w1:p1", "corrected draft"));
  expect(screen.getByText("corrected draft")).toBeVisible();
  act(() => clearDraft(undefined, "w1:p1"));
  expect(screen.getByText("Ask Ardilla…")).toBeVisible();
  expect(screen.queryByText("another bot")).not.toBeInTheDocument();
});
