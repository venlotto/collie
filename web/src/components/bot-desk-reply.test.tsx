import { act, fireEvent, render, screen } from "@testing-library/react";
import { clearAllDrafts, clearDraft, loadDraft, loadDraftEntry, saveDraft } from "@/lib/drafts";
import { BotDeskReply } from "./bot-desk-reply";

beforeEach(() => clearAllDrafts());

it("shows the saved unsent text after leaving a chat, and focusing never clears it", () => {
  const text = "Primera línea\n\nSegunda parte del mensaje";
  saveDraft(undefined, "w1:p1", text);
  const onReply = vi.fn();
  render(<BotDeskReply paneId="w1:p1" scope={{}} placeholder="Ask Ardilla…" onReply={onReply} />);
  expect(screen.getByRole("textbox")).toHaveValue(text);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  fireEvent.focus(screen.getByRole("textbox"));
  expect(onReply).toHaveBeenCalledOnce();
  expect(loadDraft(undefined, "w1:p1")).toBe(text);
});

it("follows a pending send's returned draft and its later clear without mixing panes", () => {
  render(<BotDeskReply paneId="w1:p1" scope={{}} placeholder="Ask Ardilla…" onReply={() => {}} />);
  act(() => saveDraft(undefined, "w1:p2", "another bot"));
  expect(screen.getByRole("textbox")).toHaveValue("");
  act(() => saveDraft(undefined, "w1:p1", "typed but not submitted"));
  expect(screen.getByRole("textbox")).toHaveValue("typed but not submitted");
  act(() => saveDraft(undefined, "w1:p1", "corrected draft"));
  expect(screen.getByRole("textbox")).toHaveValue("corrected draft");
  act(() => clearDraft(undefined, "w1:p1"));
  expect(screen.getByRole("textbox")).toHaveValue("");
  expect(screen.queryByText("another bot")).not.toBeInTheDocument();
});

it("accepts typing while focus changes and preserves attachment chips", () => {
  const attachments = [{ n: 1, path: "/tmp/photo.png", name: "photo.png", kind: "image" as const }];
  saveDraft({}, "w1:p1", "[Image #1]", attachments, 2);
  render(<BotDeskReply paneId="w1:p1" scope={{}} placeholder="Ask Ardilla…" onReply={() => {}} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Describe [Image #1]" } });
  expect(loadDraftEntry({}, "w1:p1")).toEqual({ text: "Describe [Image #1]", attachments, next: 2 });
  expect(screen.getByRole("textbox")).toHaveValue("Describe [Image #1]");
});
