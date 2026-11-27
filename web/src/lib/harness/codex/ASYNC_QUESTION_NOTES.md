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
| `3. Other` | Not probed. It opens a text field, so the card leaves it out. |
| `^]`, `shift+→` | Not probed, not emitted. |

What the adapter emits (`async-question.ts`): the reminder is a notice above a live box
(`MenuModel.liveBox.queued`) with one button, `["shift+Left"]`, off while the box holds a draft; the
opened question is a `prompt-select` card, one button per answer, the digit alone. The reminder's rows
also keep a `blocked` pane blocked in the bridge (`bridge/blocked-settle.ts`), the one case where a
`blocked` with a free box is a real question.

The folder-trust prompt was captured the same day (`codex--v0172-trust--w52.txt`): Herdr reports it
`idle`, the Surface lifts it as a permission ask, and a tap on "Trust and continue" through
`POST /api/ask/:id` answered it. A bare `1` typed into it did nothing; the card sends what the footer
names (TRUST_NOTES.md).
