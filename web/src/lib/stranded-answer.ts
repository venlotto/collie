// A Codex `Other` answer this phone typed into the terminal's field and could not send (the read that
// should have shown it never came, or the bridge refused the bound Enter). The words then sit in the
// field, unsent, and the pane still needs its person: the card says so and offers to send them again
// (lib/prompt-action.ts, `confirmPromptFeedback`). Remembered per pane, in memory only, so a card that
// remounts (the person left the chat and came back) still knows which words were ours. Never persisted:
// a reload forgets them, and the card then shows the field as the terminal's, with nothing to resend.

import type { PromptModel } from "./harness/prompt-model";

interface Stranded {
  /** The question the words were typed into (`coreSignature`), so another question never matches. */
  core: string;
  /** The field's key, which places the row among the answers. */
  key: string;
  /** The words as the recipe typed them (sanitised, as the screen shows them). */
  text: string;
}

const byPane = new Map<string, Stranded>();

/** Remember the words the recipe typed into `prompt`'s field on pane `key` and could not send. */
export function rememberStranded(key: string, prompt: PromptModel, text: string): void {
  const field = prompt.feedback;
  if (field?.purpose !== "other" || text === "") return;
  byPane.set(key, { core: prompt.coreSignature, key: field.key, text });
}

/** Forget them: they were sent, or the person asked for something else. */
export function forgetStranded(key: string): void {
  byPane.delete(key);
}

/**
 * The words this phone typed and could not send, when `prompt` is still the same question with its
 * `Other` field holding exactly them; null otherwise (another question, another row, other words, or
 * nothing remembered).
 */
export function strandedText(key: string, prompt: PromptModel): string | null {
  const held = byPane.get(key);
  const field = prompt.feedback;
  if (held === undefined || field?.purpose !== "other" || !field.focused) return null;
  return held.core === prompt.coreSignature && held.key === field.key && held.text === field.text ? held.text : null;
}
