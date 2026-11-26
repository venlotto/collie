// coder1's three interactive wrappers. Both claudep and kimi forward argv to Claude Code.
// The bridge resolves launches from this table; the sheet also uses it while the catalog loads.
// Keep this module free of web aliases: the root typecheck reaches it through the bridge.
export const BOT_CREATE_PROFILES = [
  { id: "codexp", harness: "codex", efforts: ["low", "medium", "high", "xhigh"] },
  { id: "claudep", harness: "claude", efforts: ["low", "medium", "high", "xhigh", "max"] },
  { id: "kimi", harness: "claude", efforts: ["low", "medium", "high"] },
] satisfies { id: string; harness: string; efforts: string[] }[];
