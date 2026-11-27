# Claude Code 2.1.332, AskUserQuestion with two questions, 54 × 23 (2026-11-27)

Byte-faithful captures, read through `GET /api/pane/:id?lines=60` from a disposable Herdr session
(its own XDG home, its own bridge), with Claude Code 2.1.332 on Haiku in `/tmp/cq-scratch`. The pane
is 54 columns by 23 rows, the shape of the diagnosis panes behind Koperca catalogue C. CRLF as read.
No secret, user or host remains; the only text is the test prompt and Claude's answers to it.

At this width the select footer wraps onto two rows, and the answer field's `ctrl+g to edit in Vim`
hint moves the wrap. The review step of 2.1.332 no longer prints "Ready to submit your answers?".

| File suffix | State |
| --- | --- |
| `narrow-unfocused` | Pet?, pointer on Cat, field empty |
| `narrow-field-focused` | Pet?, the field's digit pressed: field focused and empty |
| `narrow-field-typed` | Pet?, `Fish 42, maybe 3` typed into the field, no Enter |
| `narrow-day-unfocused` | Day? after Cat |
| `narrow-day-field-focused` | Day?, field focused |
| `narrow-day-field-typed` | Day?, `Fish 42, maybe 3` typed |
| `review` | the review step, answers `Shark 7` and `Fish 42, maybe 3` |
| `review-cat` | the review step, answers `Cat` and `Fish 42, maybe 3` |
| `answered` | after Submit: the idle box under Claude's reply |

They live outside `panes/` for now: every capture there must be registered in the corpus tables
(surface labels, binding regions, input frames, the perturbation and plain-text passes). Moving them
in, with those rows, is a follow-up.
