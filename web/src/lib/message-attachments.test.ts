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
