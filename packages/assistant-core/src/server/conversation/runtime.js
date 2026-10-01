import { createClaudeConversationAdapter } from "./providers/claude.js";
import { createCodexConversationAdapter } from "./providers/codex.js";
import { createOpenCodeConversationAdapter } from "./providers/opencode.js";

/** Native lifecycle policy. Applications supply content and owned host services. */
export function createConversationRuntime({ engine, ...host } = {}) {
  switch (engine) {
    case "claude": return createClaudeConversationAdapter(host);
    case "codex": return createCodexConversationAdapter(host);
    case "opencode": return createOpenCodeConversationAdapter(host);
    default: throw new TypeError(`Unsupported conversation engine: ${engine}`);
  }
}
