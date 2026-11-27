# Codex `request_user_input_async` — keystroke recipe

Captured 2026-11-27 on Codex 0.172.0 in a disposable Herdr session (`herdr --session <scratch>`, its
own `XDG_CONFIG_HOME`), a 52-column pane in an empty folder, model at low effort. Read with
`herdr pane read --source visible --format ansi --raw`. No real work session was touched.

The tool asks without stopping the turn. The question goes into the transcript as a history cell, and
the queue over the live input box keeps a reminder until it is answered:

```
? Tabs or spaces?

  • Tabs
  • Spaces

• Working (7s • esc to interrupt) · 1 background terminal running · …

• Queued follow-up inputs
  ? 1 question · 20s
    shift+← to answer
                            ⚠ weekly limit: 20% left

› Ask Codex to do anything
```

The `· 20s` age appears after a few seconds and ticks. The terminal title turns to
`[ ! ] Action Required | <task> | <folder>` (alternating with `[ . ]`), and Herdr reports the pane
`blocked` from it while the turn still runs. The Surface reads `turn: running`, `modal: none`,
`composer: empty`: the box takes keys, and a typed message is queued as usual.

`shift+Left` (Herdr's spelling of the printed `shift+←`) opens the question in place of the box:

```
• Queued follow-up inputs


  Tabs or spaces?

  › 1. Tabs
    2. Spaces
    3. Other

  enter submit   ^] skip   shift+→ main prompt
```

| Key | Effect |
|---|---|
| `shift+Left` on the reminder | Opens the question. Probed through Herdr and through Collie's guarded key route. |
| digit `1` / `2` on the opened question | Answers AND submits at once (`↪ Re: Tabs or spaces? / Tabs`); Herdr goes back to `working` and the title loses `Action Required`. Probed three times, two of them through the phone's card. |
| `3. Other` | See *`Other`* below. |
| `^]`, `shift+→` | Not probed, not emitted. |

What the adapter emits (`async-question.ts`): the reminder is a notice above a live box
(`MenuModel.liveBox.queued`) with one button, `["shift+Left"]`, off while the box holds a draft; the
opened question is a `prompt-select` card, one button per answer, the digit alone, and the `Other` row
as its text field. The reminder's rows also keep a `blocked` pane blocked in the bridge
(`bridge/blocked-settle.ts`), the one case where a `blocked` with a free box is a real question.

## Two questions at once (probed 2026-11-27, a scratch tmux server, 52 and 60 columns)

A scratch `tmux -L <name>` server running Codex 0.172.0 with its own `CODEX_HOME` in an empty folder
under `/tmp`; no operator pane was read or written. The prompt asked for ONE
`request_user_input_async` call with two questions. The transcript keeps one cell per question, and the
reminder counts them:

```
? Color?

  • Red
  • Blue

? Size?

  • Small
  • Large
...
• Queued follow-up inputs
  ? 2 questions · 9s
    shift+← to answer
```

`shift+Left` opens the first, with its place in the run over it and a second footer row:

```
  1 of 2
  Color?

  › 1. Red
    2. Blue
    3. Other

  enter submit   ^] skip   shift+→ main prompt
  shift+← next question
```

| Key | Effect |
|---|---|
| digit `1` on `1 of 2` | Answers the first ALONE (`↪ Re: Color? / Red` in the transcript); the second opens at once in the one-question shape (no `1 of 2`, no second footer row). Probed twice. |
| `shift+Left` on `1 of 2` | Not probed (the footer says it moves to the next question); not emitted. |

The card names every queued question (the newest cells, as many as the reminder counts, oldest
first; with fewer cells in reach it keeps the reminder's words without the ticking age). The opened
question carries `step: {index, total}` from `1 of 2`, which its caption shows and its identity
(`coreSignature`) folds in. Any other row under the footer, or a step past its total, lifts nothing.

## `Other` (probed 2026-11-27, same server)

| Step | Screen |
|---|---|
| digit `3` | The pointer moves to `› 3. Other` and the label turns FAINT (SGR 2): the field is focused and empty. Nothing is submitted. Unpointed, the label is plain. |
| typed text (raw, as `pane.send_text` writes it) | Stands in the label's place, normal weight: `› 3. Fish 42, maybe 3`. Digits are text here, not answers. |
| `Enter` | Sends it as the answer (`↪ Re: Pet? / Fish 42, maybe 3`); the next question opens. |

The card models the row as `PromptFeedback` with purpose `other`, and types into it with Claude's
plan-field recipe (`submitPromptFeedback`): entry guard, the digit, a read that shows the row focused
and empty (the faint placeholder), the text unsubmitted through the reply route, a read that shows the
exact words in the row, then `Enter` bound to that read. It refuses before any key while the row is
focused (someone is typing there) or holds text. While the row has the pointer every answer button is
locked, here and in the bridge's ask route, because a digit there would be typed into the field.

A pointed last row that is not the faint `Other` could be the field holding text or a third answer.
The transcript's cell for the question decides: one answer fewer than the panel's rows means the last
row is the field. With no such cell in reach, a pointed row lifts nothing and an unpointed one reads as
an answer, as before `Other` was read.

The probes ran over tmux, whose `send-keys -l` writes raw bytes as Herdr's `pane.send_text` does
(HERDR_API.md). The whole recipe has not yet been run through Herdr and a bridge against a live Codex.

The folder-trust prompt was captured the same day (`codex--v0172-trust--w52.txt`): Herdr reports it
`idle`, the Surface lifts it as a permission ask, and a tap on "Trust and continue" through
`POST /api/ask/:id` answered it. A bare `1` typed into it did nothing; the card sends what the footer
names (TRUST_NOTES.md).
