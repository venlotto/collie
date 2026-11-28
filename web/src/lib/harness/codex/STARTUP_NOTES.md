# Codex 0.172.0 startup, 2026-11-28

Captured from private tmux panes (52/56 × 23) on coder1, isolated CODEX_HOME.
The normal binary in a new git repository shows `Folder access`; codexp's
`--dangerously-bypass-approvals-and-sandbox` skips that dialog. Enter on
`Trust and continue` opens the editor. No probe is allowed on the trust screen.

For the update screen, only the disposable home's version.json was seeded with
latest_version 0.173.0 and a fresh last_checked_at. This exercises the real
0.172.0 widget; it is not evidence that 0.173.0 was released. The capture is
`codex--v0172-startup-update--w52.txt`. Down moved the pointer to `2. Skip`;
Enter dismissed it and opened the editor. No update was installed. Recipes
use pointer navigation and the footer's Enter, never unverified digits.

The full evidence and reproducible real-pane lab are under
`/home/ubuntu/briefs/collie-redesign/verify/codexp-1000/startup/`.
