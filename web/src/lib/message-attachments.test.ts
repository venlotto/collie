import { messageAttachments } from "./message-attachments";
const id = "term.123.mwz50y8g-12345678.png";
const path = "/home/me/.local/state/collie/uploads/" + id;
it("turns only minted upload paths into references while preserving surrounding text", () => {
  expect(messageAttachments(`${path} mira (${path}), listo`)).toEqual([
    { id }, { text: " mira (" }, { id }, { text: "), listo" },
  ]);
});
it("keeps ordinary paths, URLs, names, and marker text verbatim", () => {
  for (const text of ["/etc/passwd", "/tmp/uploads/photo.png", "[Image #1]", "https://evil.test/uploads/" + id]) {
    expect(messageAttachments(text)).toEqual([{ text }]);
  }
});

it("recognises the long Codex upload id and terminal-wrapped paths", () => {
  const codexId = "term.dd6ec3955c53ba9d4dd7652681c869d822f259447f3ee5be8e617aebd13620a7.mwz88mwb-270abe08.png";
  const codexPath = "/home/ubuntu/.local/state/collie/uploads/" + codexId;
  const wrapped = codexPath.match(/.{1,44}/gu)!.join("\n");
  for (const candidate of [codexPath, wrapped, wrapped.replace(/\n/g, "\r\n")]) {
    expect(messageAttachments(`${candidate} COL-21 retest: describe la foto adjunta y para.`)).toEqual([
      { id: codexId }, { text: " COL-21 retest: describe la foto adjunta y para." },
    ]);
  }
  expect(messageAttachments(`${wrapped}\nCOL-21 con pie en otra línea`)).toEqual([
    { id: codexId }, { text: "\nCOL-21 con pie en otra línea" },
  ]);
});
