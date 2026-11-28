# Send Protocol captures

Screens the Send Protocol tests read directly. They stay out of `web/src/fixtures/panes/` on
purpose: that corpus is read by every grammar and fold test, and these captures pin what a send reads or writes in Codex's box.

# Codex 0.172.0 at 56 columns: a typed `?` lead and a folded paste (2026-11-27)

Three ANSI reads (`tmux capture-pane -p -e`, tmux 3.4) of a throwaway Codex 0.172.0 in
`/tmp/cx-scratch`, 56 by 30, with a scratch `CODEX_HOME` whose provider points at a closed local
port, so no model was reached. No account, key or private text is in them.

| Fixture | State |
| --- | --- |
| `codex--v0172-typed-question-lead--w56.txt` | `?Explica…` (376 characters) typed as raw keys on an empty box: the `?` opened the shortcuts overlay, the next key closed it, and the box holds the text without its `?`. Codex wraps at word breaks and drops the space at each break |
| `codex--v0172-pasted-content--w56.txt` | 1231 characters on 8 lines as one bracketed paste: Codex folds it to `[Pasted Content 1231 chars]`, the count taking in the line breaks. 1000 characters or fewer land literally |
| `codex--v0172-shortcuts-overlay--w56.txt` | `?` alone typed on an empty box: the shortcuts overlay, `? / esc close` under the status row |

# Codex 0.172.0 at 56 columns: Replace over a long draft (2026-11-27)

The same lab, for `protocol.codex-draft-replace.test.ts`. The draft is the live one: "Explica en una
frase por que el cielo es azul." eight times, 376 characters, pasted and never submitted.

| Fixture | State |
| --- | --- |
| `codex--v0172-draft-376--w56.txt` | The draft in an idle box: one sentence per row, since a 54-character row does not fit the 53 the box takes |
| `codex--v0172-draft-draining--w56.txt` | 250 ms after a batch of 256 Backspaces went out: seven rows still show. Codex took all 393 in about 1.5 s |

# Codex 0.172.0 at 56 columns: a mention draft and shell mode (2026-11-27)

The same kind of lab (a scratch `CODEX_HOME` whose provider points at a closed local port, the working
folder `/tmp/pdlab/scratch`), for `protocol.codex-probe-draft.test.ts`. No account, key or private text
is in them.

| Fixture | State |
| --- | --- |
| `codex--v0172-mention-draft--w56.txt` | `mira @READ` left in the box after its file popup was closed with Escape. Any key in the `@READ` token opens the popup again |
| `codex--v0172-mention-probe-popup--w56.txt` | The old send's draft probe after it: the box holds `mira @READ⌁` and the reopened popup echoes `READ⌁` over `no matches`, so the screen shows the character twice |
| `codex--v0172-shell-mode-empty--w56.txt` | `!` typed on an empty box: the prompt glyph is a bold red `!`, and `Shell mode` stands under the status row |
| `codex--v0172-shell-mode-typed--w56.txt` | `!echo hola-bang` typed on an empty box: the box shows `! echo hola-bang`, the line without its `!` |

# Codex 0.172.0: consecutive blank paragraphs (2026-11-28)

`protocol.codex-paragraphs.test.ts` reads these ANSI captures:

- `codex--v0172-first-draft-paragraphs.txt`: a reported stranded draft from coder1,
  captured read-only from Herdr. The native editor has consecutive empty paragraphs and only a
  right-aligned warning footer, without the model status row. No credentials are included.
- `codex--v0172-native-paragraphs--w56.txt`: a separate 56 by 35 tmux terminal in
  `/tmp/collie-stranded-send-lab`, with a harmless multiline send regression prompt.
  Codex shows the model status and warning footer below the draft.

### Codex 0.172.0: running queue at 52 columns (2026-11-28)

`codex--v0172-running-queue-clipped--w52.txt` is a styled viewport from a disposable
Codex in the isolated `cx-status` tmux server, 52 × 23. A real `sleep 600` is still
running and native follow-ups are queued. The waiting row clips `esc to interrupt`
to `esc to …`; the status must remain running. No live Collie or operator pane was
written. Full receipts and captures: `briefs/collie-redesign/verify/codexp-1000/status/`.
