/** Recognise only server-minted upload references, leaving prose and ordinary paths untouched. */
export function messageAttachments(text: string): ({ text: string } | { id: string })[] {
  const out: ({ text: string } | { id: string })[] = [];
  const pattern = /(^|[\s`"'(])\/(?:[^\s/`"'<>]+\/)*uploads\/([A-Za-z0-9_.-]+-[0-9a-f]{8}\.[a-z0-9]+)(?=$|[\s`"'),.!?])/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[1]!.length;
    if (start > at) out.push({ text: text.slice(at, start) });
    out.push({ id: match[2]! });
    at = match.index + match[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
