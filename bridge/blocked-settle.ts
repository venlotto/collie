// WHEN THE SCREEN SAYS NOBODY IS ASKED, "BLOCKED" IS NOT "NEEDS YOU".
//
// Herdr derives `blocked` from the agent's own signals: Codex sets its terminal title to
// `[ ! ] Action Required | …` for an approval AND for a question it queued without stopping
// (`request_user_input_async`), and Herdr reports `blocked` from that title; Claude Code's hooks report
// one too. A queued question is real, but a title or a hook can also outlive what it announced. The
// phone showed "Needs you" for every one of them, and the person opened a chat in which nothing was
// asked (Koperca catalogue C, 2026-11-27: `blocked`, title `Action Required`, Surface `turn: running`,
// `modal: none`, `composer: empty`).
//
// So a `blocked` the multiplexer reports stands only while the screen backs it. The Surface already
// lifts a pane to `blocked` when its screen shows an ask (state-engine.ts `liftScreenAsks`); this is the
// other half. A pane whose newest read is clean (no reason, not a stale frame), shows no dialog, an input
// box that takes keys, and no queued question (lib/pending-question.ts) is not waiting on anyone: it is
// what its turn says, `working` while the turn runs, `idle` when it does not. Anything less certain
// keeps the multiplexer's word: no read yet, an unreadable or unknown screen, a stale or contested read,
// a box the read could not reach, an unknown turn. A pane blocked by an error (`blockedBy: "error"`) is
// never touched: it asks for a look, not an answer.
//
// The bridge decides this, not the phone, because the bridge acts on it alone: the push that says a
// pane needs you, the app badge and the list all read the status, and none of them has the screen.
// Pure.

import type { Surface } from "../web/src/lib/surface/surface.ts";

/** The status a multiplexer's `blocked` settles to, or null when it stands as reported. */
export type SettledStatus = "working" | "idle" | null;

/**
 * What a `blocked` pane's newest screen read proves. `surface` is that read's Surface (undefined before
 * the first read); `questionQueued` is whether the same read shows a question the agent queued for the
 * person.
 */
export function settleBlocked(surface: Surface | undefined, questionQueued: boolean): SettledStatus {
  if (surface === undefined || questionQueued) return null;
  if (surface.reason !== undefined || surface.staleFrame === true) return null;
  if (surface.modal !== "none") return null;
  if (surface.composer !== "empty" && surface.composer !== "draft") return null;
  if (surface.turn === "running") return "working";
  if (surface.turn === "idle") return "idle";
  return null;
}
