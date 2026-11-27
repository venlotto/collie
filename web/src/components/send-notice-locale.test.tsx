// The line under a send's notice speaks the person's language (2026-11-27): a Spanish iPhone showed
// "Había algo que Collie no puede leer…" with the bridge's English line under it, "The probe character
// changed more than the box. A probe character (⌁) may remain in the box. Check the pane before you
// type." The bridge writes its details in English; outside English the notice shows the catalog's line
// for the answer's code, or none where the sentence already says it.

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readingRefusal, SendRefusalNotice } from "@/components/send-notice";
import { __resetLocale, setLocale, t, whenLocaleReady } from "@/lib/i18n";
import type { JsonObject } from "@/lib/json";
import { readSend, readSendReply, type SendReply } from "@/lib/send-protocol";
import { SEND_CAUSES, SEND_REASONS, type SendCause, type SendOutcome, type SendReason } from "@/lib/surface/send";

/** Lines the live bridge sent under Spanish notices, and one made up for every other code. */
const LIVE_DETAILS = [
  "The probe character changed more than the box. A probe character (⌁) may remain in the box. Check the pane before you type.",
  "Something opened at the box after the text was typed, so Enter was not pressed.",
  "Collie could not empty the draft, so your message was not typed. Check the box, then send again. The box did not empty inside the bound.",
];
const MADE_UP = "The bridge says this in English only, Check the pane before you type.";
const ENGLISH = /\b(the|box|pane|probe|typed|was|not|before)\b/iu;

function reply(outcome: SendOutcome, reason: SendReason | null, detail: string, cause: SendCause | null = null, offers: readonly string[] = []): SendReply {
  const receipt: JsonObject = { outcome, detail };
  if (reason !== null) receipt.reason = reason;
  const body: JsonObject = { receipt, offers: [...offers] };
  if (cause !== null) body.cause = cause;
  const answer = readSendReply(body);
  if (answer === null) throw new Error("the answer did not read");
  return answer;
}

/** The words the notice draws for one answer: its sentence and the line under it, as SendRefusalNotice renders them. */
function words(answer: SendReply): string {
  const refusal = readingRefusal(readSend(answer));
  return `${refusal.sentence}${refusal.detail ?? ""}`;
}

/** What the person reads in the notice for one answer: its sentence and the line under it. */
function shown(answer: SendReply): string {
  const { container } = render(<SendRefusalNotice refusal={readingRefusal(readSend(answer))} />);
  const text = container.textContent ?? "";
  container.remove();
  return text;
}

const OUTCOMES: readonly SendOutcome[] = ["refused", "typed_not_submitted", "unknown"];

describe("in Spanish", () => {
  beforeEach(async () => {
    __resetLocale();
    setLocale("es");
    await whenLocaleReady("es");
  });
  afterEach(() => __resetLocale());

  it("no English detail reaches the notice, for any reason, cause or outcome", () => {
    for (const outcome of OUTCOMES) {
      for (const reason of [...SEND_REASONS, null]) {
        for (const cause of [...SEND_CAUSES, null]) {
          for (const detail of [...LIVE_DETAILS, MADE_UP]) {
            const text = words(reply(outcome, reason, detail, cause));
            expect(text, `${outcome} ${String(reason)} ${String(cause)}`).not.toContain(detail);
            const rest = text.replace(/Collie/gu, "");
            expect(ENGLISH.test(rest), `${outcome} ${String(reason)} ${String(cause)}: ${text}`).toBe(false);
          }
        }
      }
    }
  });

  it("the probe line of the live case is said in Spanish, under the Spanish sentence", () => {
    const text = shown(reply("refused", "probe_failed", LIVE_DETAILS[0]!));
    expect(text).toContain(t("composer.protocol.probeFailed"));
    expect(text).toContain(t("composer.detail.probeLeft"));
    expect(t("composer.detail.probeLeft")).toMatch(/carácter de prueba/u);
  });

  it("a pane too short, keys shown late and a text of several lines keep their line, translated", () => {
    expect(shown(reply("refused", "unconfirmed", "The read held 2 rows; the box takes 3.", "short_pane"))).toContain(t("composer.detail.shortPane"));
    expect(shown(reply("refused", "probe_failed", "The agent drew the keys late.", "late_keys"))).toContain(t("composer.detail.lateKeys"));
    expect(shown(reply("refused", "multiline", "Send one line at a time."))).toContain(t("composer.detail.multiline"));
  });

  it("a Replace whose draft did not empty says the message was not typed, never that Collie cannot tell", () => {
    const answer = reply("refused", "draft_present", LIVE_DETAILS[2]!, "not_emptied", ["append", "replace", "cancel"]);
    const reading = readSend(answer, "replace");
    expect(reading.note).toBe("notEmptied");
    expect(reading.offers).toEqual(["append", "replace", "cancel"]);
    const text = shown(answer);
    expect(text).toBe(t("composer.protocol.notEmptied"));
    expect(text).toMatch(/no se escribió/u);
    expect(text).not.toContain(t("composer.protocol.unknown"));
  });
});

describe("in English", () => {
  beforeEach(() => __resetLocale());

  it("the bridge's own line still shows under the sentence", () => {
    expect(shown(reply("refused", "probe_failed", LIVE_DETAILS[0]!))).toContain(LIVE_DETAILS[0]);
  });

  it("a draft that did not empty says so in the sentence, and the bridge's line is not repeated", () => {
    const text = shown(reply("refused", "not_free", LIVE_DETAILS[2]!, "not_emptied"));
    expect(text).toBe(t("composer.protocol.notEmptied"));
  });
});
