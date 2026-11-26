import type { SectionAccount } from "./api";
import { asJsonString, parseJsonObject } from "./json";

/** The owner of every per-user bot-list preference: local without SSO, the signed-in subject otherwise. */
export function botAccountForPage(): SectionAccount | null {
  const marker = document.querySelector('meta[name="collie-sso"]');
  if (!marker) return { userId: "local" };
  const account = parseJsonObject(marker.getAttribute("content") ?? "");
  const sub = asJsonString(account?.sub);
  const role = asJsonString(account?.role);
  return sub && (role === "admin" || role === "member" || role === "viewer")
    ? { userId: "sso:" + sub, sub, role } : null;
}
