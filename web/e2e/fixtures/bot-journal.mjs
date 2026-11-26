// Run with Bun, the bridge runtime. The browser gets the same normalized entries as /chat.
import { readFileSync } from "node:fs";
import { createClaudeReducer } from "../../../bridge/journal/claude";
import { createCodexReducer } from "../../../bridge/journal/codex";

const harness = process.argv[2];
if (harness !== "codex-attention" && harness !== "codex" && harness !== "claude") throw new Error("Unknown fixture");
const reducer = harness === "claude" ? createClaudeReducer() : createCodexReducer();
const file = new URL("../../../bridge/journal/fixtures/thread-clean/" + harness + ".jsonl", import.meta.url);
const entries = readFileSync(file, "utf8").trim().split("\n").flatMap(line => reducer.push(line).added);
process.stdout.write(JSON.stringify(entries));
