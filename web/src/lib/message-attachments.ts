/** Recognise only server-minted upload references, leaving prose and ordinary paths untouched. */
export function messageAttachments(text: string): ({ text: string } | { id: string })[] {
  const out: ({ text: string } | { id: string })[] = [];
  // A terminal can soft-wrap the composed line before its journal records it. A CRLF is therefore
  // part of the path candidate, never part of the id handed back to the attachment route. The lazy
  // id stops at the first valid minted name, before a caption on the following line.
  const pattern = /(^|[\s`"'(])\/(?:(?:[^\s/`"'<>\r\n]|\r?\n)+\/)*u(?:\r?\n)?p(?:\r?\n)?l(?:\r?\n)?o(?:\r?\n)?a(?:\r?\n)?d(?:\r?\n)?s\/((?:[A-Za-z0-9_.-]|\r?\n)+?-(?:[0-9a-f]|\r?\n){8}\.(?:[a-z0-9]|\r?\n)+?)(?=$|[\s`"'),.!?])/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[1]!.length;
    if (start > at) out.push({ text: text.slice(at, start) });
    out.push({ id: match[2]!.replace(/\r?\n/g, "") });
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
