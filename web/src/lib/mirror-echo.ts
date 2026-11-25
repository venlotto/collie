import { stripSgr } from "@/lib/surface/plain";

/** A display check only. The bridge's receipt decides whether a send went through. */
export function mirrorEchoCount(screen: string, text: string): number {
  const needle = text.trim().replace(/\s+/gu, " ");
  if (!needle) return 0;
  return stripSgr(screen).replace(/\s+/gu, " ").split(needle).length - 1;
}
