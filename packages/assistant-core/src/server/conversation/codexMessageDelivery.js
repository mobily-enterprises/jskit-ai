import { normalizeCodexRunText, codexAppServerPendingUserMessageOwnership } from "./codexTurnState.js";
import {
  codexAppServerNotificationItem,
  codexAppServerUserMessageText,
  codexAppServerNotificationTurnId
} from "./codexEvents.js";

// Original request deduplication and authored receipt persistence.
// One instance and its two Maps belong to the containing retained run owner.
export function createCodexAppServerMessageDelivery({
  namespace,
  publish,
  messageMetadata,
  createStore,
  turnStateFromAgentRun,
  deliveryStateMetadataKey,
  output,
  journal,
  recovery
}) {
  const {
    readAgentRunForSession: readCodexAppServerAgentRunForSession,
    writeMirroredTerminalMessage: writeMirroredCodexAppServerTerminalMessage
  } = output;
  const { writeUserMessageOwnership: writeCodexAppServerUserMessageOwnership } = journal;
  const { markProviderTurnActive: markCodexAppServerProviderTurnActive } = recovery;
  const codexAppServerMessageDeliveries = new Map();
  const codexAppServerPendingUserMessages = new Map();

  async function withCodexAppServerMessageDelivery(sessionId, messageId, pendingMessage, operation) {
    const normalizedMessageId = normalizeCodexRunText(messageId);
    const deliveryKey = normalizedMessageId ? `${namespace(sessionId)}\0${normalizedMessageId}` : "";
    const existing = deliveryKey ? codexAppServerMessageDeliveries.get(deliveryKey) : null;
    if (existing) {
      return existing;
    }
    if (deliveryKey) {
      codexAppServerPendingUserMessages.set(deliveryKey, {
        ...pendingMessage,
        receipt: Promise.withResolvers()
      });
    }
    const delivery = operation();
    if (deliveryKey) {
      codexAppServerMessageDeliveries.set(deliveryKey, delivery);
    }
    try {
      return await delivery;
    } finally {
      if (deliveryKey && codexAppServerMessageDeliveries.get(deliveryKey) === delivery) {
        codexAppServerMessageDeliveries.delete(deliveryKey);
        codexAppServerPendingUserMessages.delete(deliveryKey);
      }
    }
  }

  async function writeCodexAppServerDeliveredUserMessage(
    runtime,
    sessionId = "",
    text = "",
    messageId = "",
    turnMetadata = null,
    attachments = [],
    nativeIdentity = null
  ) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const message = normalizeCodexRunText(text);
    if (
      !normalizedSessionId ||
      (!message && !(Array.isArray(attachments) && attachments.length)) ||
      typeof runtime?.store?.writeConversationUserMessage !== "function"
    ) {
      return null;
    }
    const pendingMessage = codexAppServerPendingUserMessages.get(
      `${namespace(normalizedSessionId)}\0${normalizeCodexRunText(messageId)}`
    );
    if (pendingMessage?.recording) {
      return pendingMessage.recording;
    }
    const recording = (async () => {
      const written = await runtime.store.writeConversationUserMessage(normalizedSessionId, {
        attachments,
        nativeIdentity,
        messageId: normalizeCodexRunText(messageId),
        text: message,
        turnMetadata: messageMetadata.delivered
          ? await messageMetadata.delivered(runtime.store, normalizedSessionId, turnMetadata)
          : turnMetadata
      });
      if (!written) {
        return null;
      }
      await publish(normalizedSessionId, {
        payload: {
          conversationLogPatch: {
            turn: written,
            type: "upsert-turn"
          }
        },
        reason: "codex-app-server-message-delivered"
      });
      return written;
    })();
    if (pendingMessage) {
      pendingMessage.recording = recording;
    }
    return recording;
  }

  async function mirrorCodexAppServerTerminalUserMessage(sessionId = "", threadId = "", notification = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const item = codexAppServerNotificationItem(notification);
    const text = codexAppServerUserMessageText(item);
    const clientId = normalizeCodexRunText(item?.clientId);
    if (!normalizedSessionId || (!text && (!clientId || normalizeCodexRunText(item?.type) !== "userMessage"))) {
      return;
    }
    const store = await createStore(normalizedSessionId);
    const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
    let ownership = codexAppServerPendingUserMessageOwnership(run, clientId);
    if (!ownership && clientId && await store.conversationMessageIdExists(normalizedSessionId, clientId)) return;
    const receiptId = ownership?.clientId || clientId;
    const pendingMessage = codexAppServerPendingUserMessages.get(
      `${namespace(normalizedSessionId)}\0${receiptId}`
    );
    let recoveredMessage = null;
    if (receiptId && !pendingMessage) {
      const saved = JSON.parse(await store.readMetadataValue(normalizedSessionId, deliveryStateMetadataKey) || "null");
      const pending = Object.values(saved?.engines || {}).map((binding) => binding.pending)
        .find((candidate) => candidate?.messageId === receiptId && candidate.threadId === normalizedThreadId);
      if (pending) {
        recoveredMessage = pending;
        ownership ||= { clientId: receiptId, inputSource: "chat" };
      }
    }
    if (!text && (!ownership || !(
      Array.isArray(pendingMessage?.attachments) && pendingMessage.attachments.length ||
      Array.isArray(recoveredMessage?.displayAttachments) && recoveredMessage.displayAttachments.length
    ))) return;
    if (ownership) {
      // The provider's user-message receipt precedes its answer notifications.
      // Persist the authored message here so answers cannot overtake it while
      // the original HTTP request is still finishing startup bookkeeping.
      if (pendingMessage) {
        await writeCodexAppServerDeliveredUserMessage(
          { store },
          normalizedSessionId,
          pendingMessage.text,
          ownership.clientId,
          { ...await messageMetadata.actor?.(pendingMessage.actorContext), ...pendingMessage.turnMetadata },
          pendingMessage.attachments,
          { threadId: normalizedThreadId, turnId: codexAppServerNotificationTurnId(notification) }
        );
      } else if (recoveredMessage) {
        await writeCodexAppServerDeliveredUserMessage(
          { store }, normalizedSessionId, recoveredMessage.displayMessage, receiptId,
          recoveredMessage.turnMetadata, recoveredMessage.displayAttachments,
          { threadId: normalizedThreadId, turnId: codexAppServerNotificationTurnId(notification) }
        );
      }
      const turn = turnStateFromAgentRun(run || {});
      const providerTurnId = codexAppServerNotificationTurnId(notification);
      const providerTurnAlreadyTracked = normalizeCodexRunText(turn.state) === "active" &&
        (!normalizedThreadId || normalizeCodexRunText(turn.threadId) === normalizedThreadId) &&
        (!providerTurnId || normalizeCodexRunText(turn.turnId) === providerTurnId);
      if (!providerTurnAlreadyTracked) {
        await markCodexAppServerProviderTurnActive(normalizedSessionId, {
          inputSource: ownership.inputSource,
          status: "inProgress",
          threadId: normalizedThreadId,
          turnId: providerTurnId
        });
      }
      await writeCodexAppServerUserMessageOwnership(
        store,
        normalizedSessionId,
        ownership.clientId,
        {
          eventKind: "codex-app-server-user-message-consumed",
          owned: false
        }
      );
      if (providerTurnId) {
        pendingMessage?.receipt.resolve({ id: providerTurnId });
      }
      return;
    }
    await markCodexAppServerProviderTurnActive(normalizedSessionId, {
      status: "inProgress",
      threadId: normalizedThreadId,
      turnId: codexAppServerNotificationTurnId(notification)
    });
    await writeMirroredCodexAppServerTerminalMessage({
      notification,
      role: "user",
      sessionId: normalizedSessionId,
      text,
      threadId: normalizedThreadId
    });
  }

  return {
    messageDeliveries: codexAppServerMessageDeliveries,
    pendingUserMessages: codexAppServerPendingUserMessages,
    withMessageDelivery: withCodexAppServerMessageDelivery,
    writeDeliveredUserMessage: writeCodexAppServerDeliveredUserMessage,
    mirrorTerminalUserMessage: mirrorCodexAppServerTerminalUserMessage
  };
}
