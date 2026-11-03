import { createConversationSystemPrompt } from "../systemPrompt.js";

/**
 * @typedef {import("../claudeProcess.js").ClaudeCodeProcess} ClaudeCodeProcess
 */

/**
 * The conversation owner's control of its one native process.
 * @typedef {object} ClaudeProcessControl
 * @property {() => ClaudeCodeProcess | null} getProcess
 * @property {() => boolean} isActive
 * @property {(input: object) => Promise<ClaudeCodeProcess>} startProcess
 * @property {(reason: string) => Promise<unknown>} stopProcess
 */

/**
 * One instance per native Claude conversation; process ownership stays with the host.
 * @param {ClaudeProcessControl} control
 */
export function createClaudeConversationAdapter({ getProcess, isActive, startProcess, stopProcess }) {
  const instructions = createConversationSystemPrompt();
  let pending = Promise.resolve();
  let updateIdentity;
  let installedMode;
  let installedPrompt;

  function instructionArguments({ systemPrompt, instructionMode = "append" }) {
    if (typeof systemPrompt !== "string" || !systemPrompt.trim()) throw new TypeError("Claude instructions must contain text.");
    if (!["append", "replace"].includes(instructionMode)) throw new TypeError("Invalid instruction mode.");
    // Claude otherwise restores its recorded system prompt on resume, ignoring
    // changed prompt arguments until compaction. The host supplies current text.
    return [instructionMode === "replace" ? "--system-prompt" : "--append-system-prompt", systemPrompt,
      "--system-prompt-snapshot", "off"];
  }

  function prepare(input) {
    // Check active work when this request reaches the front of the queue, so
    // a queued change cannot stop a turn admitted during earlier preparation.
    const operation = pending.catch(() => {}).then(async () => {
      const { systemPrompt, settings, model, liveUpdateIdentity } = input;
      const instructionMode = input.instructionMode || "append";
      const contextIdentity = JSON.stringify([input.contextIdentity, instructionMode]);
      if (!getProcess()) instructions.invalidate();
      const canUpdate = getProcess() && installedPrompt === systemPrompt && installedMode === instructionMode &&
        liveUpdateIdentity !== undefined && updateIdentity === liveUpdateIdentity;
      if (getProcess() && isActive() && !canUpdate && !instructions.isCurrent({ systemPrompt, contextIdentity })) {
        throw new Error("Stop the current Claude turn before changing its settings.");
      }
      return instructions.ensure({
        systemPrompt,
        contextIdentity,
        install: async ({ promptChanged }) => {
          let native = getProcess();
          const canUpdate = native && !promptChanged && installedMode === instructionMode &&
            liveUpdateIdentity !== undefined && updateIdentity === liveUpdateIdentity;
          if (!canUpdate) {
            // The host must prove owned cleanup before launching the successor.
            await stopProcess("Claude's previous process was stopped before reconnecting.");
            native = await startProcess({ ...input, instructionArguments: instructionArguments(input) });
          }
          try {
            await native.client.request({ subtype: "apply_flag_settings", settings });
            await native.client.request({ subtype: "set_model", model });
          } catch (error) {
            await stopProcess(error.message);
            throw error;
          }
          updateIdentity = liveUpdateIdentity;
          installedMode = instructionMode;
          installedPrompt = systemPrompt;
          return native;
        }
      });
    });
    pending = operation;
    return operation;
  }

  /** The latest queued preparation. */
  function whenIdle() {
    return pending;
  }

  return Object.freeze({
    prepare,
    instructionArguments,
    invalidate: instructions.invalidate,
    whenIdle
  });
}
