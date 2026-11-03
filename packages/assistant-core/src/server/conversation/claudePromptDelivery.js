import { randomUUID } from "node:crypto";
import { claudeNativeMessageId } from "./claudeHistory.js";
import { normalizeNullableText } from "./normalize.js";
import { ignorePromptSending, ignoreReceipt } from "./nativeCommandCallbacks.js";

/**
 * Delivers an authored input to an entry's Claude process: duplicate checks,
 * preparation, steering, the new turn, and the native and persisted receipts.
 * @param {{
 *   store: import("./claudeTurn.js").ClaudeConversationStore,
 *   preparation: import("./claudeTurn.js").ClaudeConversationPreparation,
 *   createError: import("./claudeTurn.js").ClaudeConversationErrorFactory,
 *   onEvent: import("./claudeTurn.js").ClaudeConversationEventHandler,
 *   readHistory: (entry: import("./claudeTurn.js").ClaudeConversationEntry) => Promise<Record<string, any>>,
 *   bindAccount: (entry: import("./claudeTurn.js").ClaudeConversationEntry) => Promise<void>,
 *   ensureProcess: (entry: import("./claudeTurn.js").ClaudeConversationEntry, input?: Record<string, any>) => Promise<Record<string, any>>,
 *   snapshot: (entry: import("./claudeTurn.js").ClaudeConversationEntry) => Record<string, any> | null
 * }} options
 */
export function createClaudePromptDelivery({
  store,
  preparation,
  createError,
  onEvent,
  readHistory,
  bindAccount,
  ensureProcess,
  snapshot
}) {
  async function send(entry, ...args) {
    entry.sending = (entry.sending || 0) + 1;
    try { return await dispatchPrompt(entry, ...args); }
    finally { entry.sending -= 1; }
  }

  async function dispatchPrompt(entry, input = {}, { renewal = false, command, applicationCommand } = {}) {
    const message = command ? input.text : normalizeNullableText(input.message || input.prompt);
    if (!command && !message) throw createError("Enter a message for Claude.", { code: "conversation_claude_message_required" });
    const context = entry.context;
    const messageId = command ? input.messageId : normalizeNullableText(input.messageId) || randomUUID();
    const uuid = claudeNativeMessageId(messageId);
    const deliveryTiming = (command || input).deliveryTiming;
    const { onNativeReceipt = ignoreReceipt, onReceiptPersisted = ignoreReceipt } = command || input;
    const { onPromptSending = ignorePromptSending } = input;
    if (!command) {
      if (entry.main && await store.hasMessage(context, messageId)) {
        return { ok: true, delivered: true, duplicate: true, thread: { id: entry.id }, turn: snapshot(entry) };
      }
      deliveryTiming?.("duplicate-checked");
      preparation.check(entry, context);
      const history = await readHistory(entry);
      deliveryTiming?.("native-history-read");
      if (history.userIds.includes(uuid)) {
        return { ok: true, delivered: true, duplicate: true, thread: { id: entry.id }, turn: snapshot(entry) };
      }
    }
    let native;
    try {
      if (!command && entry.turn?.active && entry.process) {
        // Steering keeps the active instruction installation, just like command
        // steering, in Main and in every other conversation: guidance changed
        // by the running work (a repair editing the project's Genesis files)
        // applies at the next idle admission and never refuses the message.
        // Account replacement must still confirm cleanup before any new send.
        if (preparation.account) await bindAccount(entry);
        native = entry.process || await ensureProcess(entry, input);
      } else {
        native = command ? command.steering ? entry.process : await entry.nativeTurn.prepare(command.prepared) : await ensureProcess(entry, input);
      }
    } catch (error) {
      // Preparation may start or resume the process, but has not written this
      // authored input. Keep its failure distinct from a lost native receipt.
      throw Object.assign(error, { delivery: "not-sent" });
    }
    deliveryTiming?.("process-ready");
    if (command && !command.steering) command.signal.throwIfAborted();
    const steering = command ? command.steering === true : Boolean(entry.turn?.active);
    if (input.signal?.aborted) {
      throw Object.assign(createError("The goal command was stopped before delivery.", { code: "conversation_claude_command_stopped" }), { delivery: "not-sent" });
    }
    if (steering) {
      if (command) {
        await command.beforeDispatch({ threadId: entry.id });
        command.signal.throwIfAborted();
      }
      // A mid-turn message is never an interrupt: Claude Code queues it and
      // reads it after the running tool call. Only explicit Stop interrupts.
      try { await entry.nativeTurn.prepareSteering(); }
      catch (error) {
        if (!command) await entry.nativeTurn.stopProcess(error.message);
        // This precedes the input's pipe write: a refused steer is definitely not sent.
        throw Object.assign(error, { delivery: "not-sent" });
      }
    }
    const prompt = command ? undefined : await preparation.message(entry, input, { context, message, steering, renewal, deliveryTiming });
    if (!command) deliveryTiming?.("prompt-rendered");
    if (command) {
      await command.beforeDispatch({ threadId: entry.id });
      command.signal.throwIfAborted();
    }
    if (!steering) {
      entry.renewal = renewal;
      entry.nativeTurn.begin({ id: uuid, maxOutputCharacters: command ? command.maximumOutput : entry.profile?.limits.maxOutputCharacters });
      entry.observationError = "";
      entry.turn = { id: uuid, active: true, state: "starting", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), error: "" };
      if (!command) entry.completion = Promise.withResolvers();
      if (!command) await entry.nativeTurn.updateState("starting");
    }
    entry.onEvent = context.onEvent;
    entry.lastMessageId = uuid;
    const actorMetadata = command ? undefined : await onEvent(entry, { type: "message-metadata", input, context });
    if (!command) deliveryTiming?.("metadata-ready");
    const nativeOwner = applicationCommand ? { process: native, executionId: entry.executionId,
      accountIdentity: entry.accountIdentity, threadId: entry.id, turnId: entry.turn.id } : null;
    let conversationTurn;
    function deliveryResult() {
      return { ok: true, delivered: true, deliveryMode: steering ? "steer" : "new_turn",
        thread: { id: entry.id }, turn: snapshot(entry), workdir: context.workdir, conversationTurn };
    }
    async function accept() {
      onNativeReceipt();
      // The new native ACK retires old effect custody while its canonical
      // admission/commit is awaited; it cannot retag a delayed old failure.
      if (applicationCommand) applicationCommand.active.nativeOwner = null;
      if (command) {
        if (!steering) await onEvent(entry, { type: "binding-admitted" });
        await command.accept();
        if (steering) {
          command.active.messageId = input.messageId;
          command.active.nativeToolCount = 0;
        } else command.active.admitted = true;
        command.admitted = true;
      } else {
        const admission = onEvent(entry, { type: "admit-message", input, context, renewal, message, messageId, uuid, actorMetadata });
        if (admission) conversationTurn = await admission;
        deliveryTiming?.("receipt-written");
      }
      if (!command) {
        await entry.nativeTurn.updateState("active");
        deliveryTiming?.("state-active");
      }
      onReceiptPersisted();
      if (applicationCommand && conversationTurn) {
        const value = deliveryResult();
        const active = applicationCommand.active;
        const previousCompletion = active.completion;
        if (active.finishIfCurrent) {
          active.completion = Promise.withResolvers();
          active.completion.promise.catch(() => {});
        }
        active.delivery = { value, completion: active.finishIfCurrent ? active.completion.promise : entry.completion?.promise };
        if (active.finishIfCurrent) previousCompletion.resolve();
        // The original canonical admission and publication precede Core's same
        // accepted-request gate; native tools cannot race an unaccepted user.
        await applicationCommand.accept({ nativeResult: { value }, conversationTurn, nativeTurnId: entry.turn?.id });
        if (entry.process !== nativeOwner.process || entry.executionId !== nativeOwner.executionId ||
            entry.accountIdentity !== nativeOwner.accountIdentity || entry.id !== nativeOwner.threadId ||
            entry.turn?.id !== nativeOwner.turnId || entry.disposed || entry.stopping || entry.stopPending) {
          throw new Error("Claude's admitted tools no longer belong to this native process.");
        }
        applicationCommand.active.nativeOwner = nativeOwner;
        applicationCommand.active.messageId = messageId;
        if (steering) applicationCommand.active.nativeToolCount = 0;
        applicationCommand.active.admitted = true;
      }
    }
    try {
      if (command) command.attempted = true;
      else await onPromptSending({ threadId: entry.id, displayAttachments: input.displayAttachments, turnMetadata: actorMetadata });
      if (input.signal?.aborted) {
        throw Object.assign(createError("The goal command was stopped before delivery.", { code: "conversation_claude_command_stopped" }), { delivery: "not-sent" });
      }
      await entry.nativeTurn.send(command ? entry.process.client : native.client, command ? preparation.message(entry, input) : prompt,
        { messageId: uuid, accept, steer: steering, ...(command ? { timeoutMs: command.timeoutMs } : {}) });
    } catch (error) {
      if (!command) await entry.nativeTurn.stopProcess(error.message);
      throw error;
    }
    return deliveryResult();
  }

  return Object.freeze({
    send
  });
}
