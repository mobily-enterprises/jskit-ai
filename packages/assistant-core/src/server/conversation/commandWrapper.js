import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const shellQuote = value => `'${value.replaceAll("'", `'"'"'`)}'`;

export function validateCommandWrapper(wrapper) {
  if (typeof wrapper !== "string" || !isAbsolute(wrapper) || wrapper.includes("\0")) {
    throw new TypeError("host.commandWrapper must name an absolute executable path.");
  }
}

/** The host executable receives the original command as one argument. */
export function wrapNativeCommand(wrapper, command) {
  validateCommandWrapper(wrapper);
  if (typeof command !== "string" || !command.trim() || command.includes("\0")) {
    throw new TypeError("The native shell tool requires valid command text.");
  }
  return `${shellQuote(wrapper)} ${shellQuote(command)}`;
}

export function nativeCommandHook(wrapper, input) {
  if (input?.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash") {
    throw new Error("The command hook received an unexpected native tool.");
  }
  try {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow",
      updatedInput: { ...input.tool_input, command: wrapNativeCommand(wrapper, input.tool_input?.command) } } };
  } catch (error) {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
      permissionDecisionReason: error.message } };
  }
}

export function codexCommandHookCommand(wrapper) {
  validateCommandWrapper(wrapper);
  return [process.execPath, fileURLToPath(new URL("./commandHook.js", import.meta.url)), wrapper].map(shellQuote).join(" ");
}
