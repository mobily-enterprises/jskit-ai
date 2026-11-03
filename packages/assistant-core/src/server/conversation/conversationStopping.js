import { serial } from "./conversationEvents.js";

// The newest messages cancelled in one open conversation, refused if sent again.
const MAX_CANCELLED_MESSAGES = 100;

/**
 * Stopping work in an open conversation: stopping its turn, cancelling one message, retrying
 * a failed save, and disposing or retiring its entry.
 * @param {object} dependencies
 * @param {import("../types.js").ReentrantConversationStorage | null} dependencies.storage
 * @param {import("../types.js").ConversationStreams} dependencies.streams
 * @param {Map<string, any>} dependencies.entries The open conversations, by namespace or id.
 * @param {import("./conversationEvents.js").ConversationEvents} dependencies.events
 * @param {import("./conversationReads.js").ConversationReads} dependencies.reads
 * @param {import("./conversationDelivery.js").ConversationDelivery} dependencies.delivery
 */
function createConversationStopping({ storage, streams, entries, events, reads, delivery }) {
  async function stop(entry, context, input, representation) {
    if (representation === "native") return entry.provider.cancel({ context, input, representation });
    const active = entry.active;
    if (!active && entry.executionFailure) {
      await entry.provider.cancel();
      await retrySave(entry);
      if (entry.cleanupTurnId && !entry.conversation) await storage.write(entry.id, async transaction => {
        const turn = await transaction.readTurn(entry.cleanupTurnId);
        await transaction.updateTurnMetadata(entry.cleanupTurnId,
          { runtime: { ...turn.metadata.runtime, status: "cancelled", error: "Work stopped." } });
      });
      entry.executionFailure = null;
      entry.cleanupTurnId = null;
      entry.error = "Work stopped.";
      return { stopped: true };
    }
    if (!active) {
      if (!entry.conversation && !entry.driver.canonicalTranscript) return { stopped: false };
      const metadata = { runtime: await reads.readState(entry) };
      const result = await entry.provider.cancel({ configuration: metadata.runtime.configuration, context });
      return { stopped: result?.interrupted === true || result?.operationOutcome === "interrupted" };
    }
    active.controller.abort(new Error("Work stopped."));
    await active.done;
    if (entry.executionFailure) throw entry.executionFailure;
    return { stopped: true };
  }

  // Cancel of one message in a runtime-owned conversation never waits for the
  // conversation queue. The message is recorded as cancelled at once, so a send
  // of it still queued, or arriving later, is refused as not sent; its own
  // submission stops, ending any turn it started. Its unconfirmed request or
  // pending native attempt is discarded afterwards, in queue order. A message
  // already accepted stays history.
  async function cancelDelivery(entry, context, messageId, representation) {
    entry.cancelledMessages.delete(messageId);
    entry.cancelledMessages.add(messageId);
    if (entry.cancelledMessages.size > MAX_CANCELLED_MESSAGES) entry.cancelledMessages.delete(entry.cancelledMessages.values().next().value);
    const interrupted = Boolean(entry.active?.requests.has(messageId));
    if (interrupted) await stop(entry, context, undefined, representation);
    void serial(entry, async () => {
      await events.access(context, entry.id, "cancel", entry);
      if (entry.conversation) {
        await delivery.nativeChangeover(entry, context, null, () => { throw new Error("Cancel never sends a message."); }).discard({ messageId });
        return;
      }
      await storage.write(entry.id, async transaction => {
        const metadata = await transaction.readMetadata();
        if (metadata.runtime.request?.messageId !== messageId) return;
        delete metadata.runtime.request;
        await transaction.writeMetadata(metadata);
      });
    }).catch(() => {});
    return { ok: true, cancelled: true, messageId, interrupted };
  }

  async function retrySave(entry) {
    if (!entry.storageFailure || !entry.saveProgress) return { saved: false };
    const event = await entry.saveProgress();
    await events.emit(entry, event);
    return { saved: true };
  }

  function retireEntry(entry) {
    entry.disposed = true;
    entry.listeners.clear();
    // Live streams are kept per conversation id. A logical conversation streams
    // through its own owner, so the stream under its id belongs to another entry
    // with the same id, such as its session's Main conversation.
    if (!entry.conversation?.commands) streams.clear(entry.id);
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
  }

  async function disposeEntry(entry, context, options, representation) {
    if (entry.conversation?.commands) { retireEntry(entry); return; }
    if (!entry.conversation) await stop(entry, context);
    await retrySave(entry);
    const result = await entry.provider.dispose(entry.conversation?.native?.scoped && representation === "native"
      ? { input: options, context } : representation === "native" ? options : undefined);
    if (result?.ok === false) return result;
    if (entry.conversation) await entry.active?.done;
    retireEntry(entry);
    return result;
  }

  return Object.freeze({
    stop,
    cancelDelivery,
    retrySave,
    retireEntry,
    disposeEntry
  });
}

/** @typedef {ReturnType<typeof createConversationStopping>} ConversationStopping */

export { createConversationStopping };
