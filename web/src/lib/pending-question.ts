// A QUESTION THE AGENT QUEUED FOR THE PERSON, read off the screen (Codex 0.172.0, captured 2026-11-27
// on a disposable Herdr pane, fixtures/panes/codex--v0172-async-*).
//
// Codex's `request_user_input_async` asks without stopping the turn. The question goes into the
// transcript as a history cell, the turn keeps running, and the queue above the input box keeps a
// two-row reminder until the person answers it:
//
//   • Queued follow-up inputs
//     ? 1 question · 7s
//       shift+← to answer
//   ...
//   › Ask Codex to do anything
//
// The terminal title turns to `[ ! ] Action Required`, and Herdr reports the pane `blocked` from it.
// So "blocked" on a pane whose box is free is a real question only while these rows are on screen: the
// bridge reads them to keep such a pane `blocked` and to let every other `blocked` with a free box fall
// back to what its screen shows (bridge/blocked-settle.ts), and Codex's grammar lifts them into a card
// (harness/codex/async-question.ts). One reader, so the list's "Needs you" and the card agree.
//
// Pure, no imports: the bridge imports it by relative path.

/** The reminder row: `? 1 question`, with an optional `· 7s` age, or the reminder on one row. */
const COUNT = /^\s*\? (\d{1,2}) questions?(?:\s+·\s+\d+[smh])?(?:\s+[—·-]\s+shift\+← to answer)?\s*$/;
/** The row that names the key: `shift+← to answer`. */
const KEY = /^\s*shift\+← to answer\s*$/;
/** The same key on the reminder row itself, the one-row shape. */
const KEY_INLINE = /shift\+← to answer\s*$/;

/** The reminder on screen: its rows (`first` to `last`, both included) and how many questions wait. */
export interface QueuedQuestion {
  readonly first: number;
  readonly last: number;
  readonly count: number;
}

/**
 * The LOWEST reminder on the screen's rows, or null. Lowest, because a copy higher up is transcript
 * (a person who pasted the words): the live queue sits right above the input box.
 */
export function queuedQuestion(texts: readonly string[]): QueuedQuestion | null {
  for (let i = texts.length - 1; i >= 0; i--) {
    const match = COUNT.exec(texts[i]!);
    if (match === null) continue;
    const count = Number(match[1]);
    if (count < 1) continue;
    if (KEY_INLINE.test(texts[i]!)) return { first: i, last: i, count };
    const next = texts[i + 1];
    if (next !== undefined && KEY.test(next)) return { first: i, last: i + 1, count };
  }
  return null;
}
