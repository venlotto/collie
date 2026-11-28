import { fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { SessionStream } from "./session-stream";
import type { ChatMessageListHandle } from "./ui/chat/chat-message-list";
import { EMPTY_CHAT_WINDOW } from "@/lib/chat-window";
import type { ChatEntry } from "@/lib/types";

beforeAll(() => {
  // jsdom has no scrolling implementation; the stream scrolls on mount.
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});

const listRef = createRef<ChatMessageListHandle>();
const entries: ChatEntry[] = [
  { uuid: "request", seq: 1, ts: "2026-11-28T00:00:01Z", role: "user", parts: [{ kind: "text", text: "Review the chat" }] },
  { uuid: "thinking", seq: 2, ts: "2026-11-28T00:00:02Z", role: "assistant", parts: [{ kind: "thinking", text: "Inspecting the chat" }] },
  { uuid: "progress", seq: 3, ts: "2026-11-28T00:00:03Z", role: "assistant", parts: [{ kind: "text", text: "I found the cause and am fixing it." }] },
];

function stream(working: boolean, rows = entries, questionPending = false, readable = true) {
  return <SessionStream
    bot={{ name: "Reviewer", silhouette: 0, color: 0 }}
    feed={{
      window: { ...EMPTY_CHAT_WINDOW, status: readable ? { kind: "live" } : { kind: "unavailable", reason: "no-log" }, entries: rows },
      loadOlder: vi.fn(), loadingOlder: false, asked: 0, answered: 0, tried: true,
    }}
    address="working-status:pane"
    agent="codex"
    working={working}
    questionPending={questionPending}
    showToolCalls
    showCompactions={false}
    fontSize={14}
    listRef={listRef}
  />;
}

describe("the bot chat's working status", () => {
  it("keeps a live status after a progress message and later grouped steps until the turn ends", () => {
    const { rerender, ...view } = render(stream(true));
    expect(view.queryByText("I found the cause and am fixing it.")).not.toBeInTheDocument();
    expect(view.getAllByText("Still working…")).toHaveLength(1);
    fireEvent.click(view.getByRole("button", { name: "2 steps" }));
    const progress = view.getByText("I found the cause and am fixing it.");
    const status = view.getByRole("status", { name: "Still working…" });
    expect(status).toHaveTextContent("Still working…");
    expect(progress.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const continued: ChatEntry[] = [...entries, {
      uuid: "checking", seq: 4, ts: "2026-11-28T00:00:04Z", role: "assistant", parts: [{ kind: "thinking", text: "Checking the fix" }],
    }];
    rerender(stream(true, continued));
    expect(view.getByRole("status", { name: "Still working…" })).toBe(status);

    const completed: ChatEntry[] = [...continued, {
      uuid: "answer", seq: 5, ts: "2026-11-28T00:00:05Z", role: "assistant", parts: [{ kind: "text", text: "Fixed and checked." }],
    }];
    rerender(stream(false, completed));
    expect(view.queryByRole("status", { name: "Still working…" })).not.toBeInTheDocument();
    expect(progress).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "3 steps" }));
    expect(view.queryByText("I found the cause and am fixing it.")).not.toBeInTheDocument();
    expect(view.getByText("Fixed and checked.")).toBeVisible();
  });

  it("keeps the tail status even when grouped activity is the newest content", () => {
    const view = render(stream(true, entries.slice(0, 2)));
    expect(view.getByRole("status", { name: "Still working…" })).toBeInTheDocument();
  });

  it("removes the working status while a question needs an answer and restores it on resume", () => {
    const { rerender, ...view } = render(stream(true));
    rerender(stream(true, entries, true));
    expect(view.queryByRole("status", { name: "Still working…" })).not.toBeInTheDocument();
    rerender(stream(true));
    expect(view.getByRole("status", { name: "Still working…" })).toBeInTheDocument();
  });

  it("does not claim activity inside an unreadable conversation", () => {
    const view = render(stream(true, [], false, false));
    expect(view.queryByRole("status", { name: "Still working…" })).not.toBeInTheDocument();
  });
});
