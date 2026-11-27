# Send Protocol captures

Screens the Send Protocol tests read directly. They stay out of `web/src/fixtures/panes/` on
purpose: that corpus is read by every grammar and fold test, and these three exist only to pin
what a send writes into Codex's box.

# Codex 0.172.0 at 56 columns: a typed `?` lead and a folded paste (2026-11-27)

Three ANSI reads (`tmux capture-pane -p -e`, tmux 3.4) of a throwaway Codex 0.172.0 in
`/tmp/cx-scratch`, 56 by 30, with a scratch `CODEX_HOME` whose provider points at a closed local
port, so no model was reached. No account, key or private text is in them.

| Fixture | State |
| --- | --- |
| `codex--v0172-typed-question-lead--w56.txt` | `?Explica…` (376 characters) typed as raw keys on an empty box: the `?` opened the shortcuts overlay, the next key closed it, and the box holds the text without its `?`. Codex wraps at word breaks and drops the space at each break |
| `codex--v0172-pasted-content--w56.txt` | 1231 characters on 8 lines as one bracketed paste: Codex folds it to `[Pasted Content 1231 chars]`, the count taking in the line breaks. 1000 characters or fewer land literally |
| `codex--v0172-shortcuts-overlay--w56.txt` | `?` alone typed on an empty box: the shortcuts overlay, `? / esc close` under the status row |
