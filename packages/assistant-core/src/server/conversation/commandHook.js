import { nativeCommandHook } from "./commandWrapper.js";

// Codex invokes a command hook; Claude delivers this same input over its SDK
// control channel. Neither mechanism owns the application's shell policy.
const chunks = [];
let size = 0;
try {
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error("The native command hook input exceeded its size limit.");
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  process.stdout.write(`${JSON.stringify(nativeCommandHook(process.argv[2], input))}\n`);
} catch {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
    permissionDecisionReason: "The host could not bind this native command to its execution wrapper." } })}\n`);
}
