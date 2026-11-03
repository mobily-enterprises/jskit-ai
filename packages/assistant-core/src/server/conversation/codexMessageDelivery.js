import { codexAppServerPendingUserMessageOwnership } from "./codexTurnState.js";
import {
  codexAppServerNotificationItem,
  codexAppServerUserMessageText,
  codexAppServerNotificationTurnId
} from "./codexEvents.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function ignoreMessageReceipt() {}

/**
 * Request deduplication and authored receipt persistence. One instance and its two Maps belong to its run owner.
 * @param {object} dependencies
 * @param {import("./codexTurn.js").CodexSessionNamespace} dependencies.namespace
 * @param {import("./codexTurn.js").CodexPublish} dependencies.publish
 * @param {import("./codexTurn.js").CodexMessageMetadataHooks} dependencies.messageMetadata
 * @param {import("./codexTurn.js").CodexCreateStore} dependencies.createStore
 * @param {import("./codexTurn.js").CodexAgentRunTurnStateReader} dependencies.turnStateFromAgentRun
 * @param {string} dependencies.deliveryStateMetadataKey
 * @param {import("./codexOutput.js").CodexAppServerOutput} dependencies.output
 * @param {import("./codexRunJournal.js").CodexRunJournal} dependencies.journal
 * @param {import("./codexTurnRecovery.js").CodexTurnRecovery} dependencies.recovery
 */
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

  function messageDeliveryKey(sessionId, messageId) {
    return `${namespace(sessionId)}\0${messageId}`;
  }

  function pendingUserMessage(sessionId, messageId) {
    return codexAppServerPendingUserMessages.get(messageDeliveryKey(sessionId, messageId));
  }

  async function withCodexAppServerMessageDelivery(sessionId, messageId, pendingMessage, operation) {
    const normalizedMessageId = normalizeText(messageId);
    const deliveryKey = normalizedMessageId ? messageDeliveryKey(sessionId, normalizedMessageId) : "";
    const existing = deliveryKey ? codexAppServerMessageDeliveries.get(deliveryKey) : null;
    if (existing) {
      return existing;
    }
    if (deliveryKey) {
      const { onNativeReceipt = ignoreMessageReceipt, onReceiptPersisted = ignoreMessageReceipt } = pendingMessage;
      codexAppServerPendingUserMessages.set(deliveryKey, {
        ...pendingMessage,
        onNativeReceipt,
        onReceiptPersisted,
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
    nativeIdentity = null,
    data
  ) {
    const normalizedSessionId = normalizeText(sessionId);
    const message = normalizeText(text);
    if (
      !normalizedSessionId ||
      (!message && !(Array.isArray(attachments) && attachments.length))
    ) {
      return null;
    }
    const pendingMessage = pendingUserMessage(normalizedSessionId, normalizeText(messageId));
    if (pendingMessage?.recording) {
      return pendingMessage.recording;
    }
    const authored = pendingMessage?.authoredInput;
    const applicationData = authored?.messageId === normalizeText(messageId) ? authored.data : data;
    const recording = (async () => {
      const written = await runtime.store.writeConversationUserMessage(normalizedSessionId, {
        attachments,
        nativeIdentity,
        messageId: normalizeText(messageId),
        text: message,
        ...(applicationData !== undefined ? { data: structuredClone(applicationData) } : {}),
        turnMetadata: await messageMetadata.delivered(runtime.store, normalizedSessionId, turnMetadata)
      });
      if (!written) {
        return null;
      }
      pendingMessage?.onReceiptPersisted();
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
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const item = codexAppServerNotificationItem(notification);
    const text = codexAppServerUserMessageText(item);
    const clientId = normalizeText(item?.clientId);
    if (!normalizedSessionId || (!text && (!clientId || normalizeText(item?.type) !== "userMessage"))) {
      return;
    }
    const store = await createStore(normalizedSessionId);
    const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
    let ownership = codexAppServerPendingUserMessageOwnership(run, clientId);
    if (!ownership && clientId && await store.conversationMessageIdExists(normalizedSessionId, clientId)) return;
    const receiptId = ownership?.clientId || clientId;
    const pendingMessage = pendingUserMessage(normalizedSessionId, receiptId);
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
      pendingMessage?.onNativeReceipt();
      // The provider's user-message receipt precedes its answer notifications.
      // Persist the authored message here so answers cannot overtake it while
      // the original HTTP request is still finishing startup bookkeeping.
      if (pendingMessage) {
        await writeCodexAppServerDeliveredUserMessage(
          { store },
          normalizedSessionId,
          pendingMessage.text,
          ownership.clientId,
          { ...await messageMetadata.actor(pendingMessage.actorContext), ...pendingMessage.turnMetadata },
          pendingMessage.attachments,
          { threadId: normalizedThreadId, turnId: codexAppServerNotificationTurnId(notification) }
        );
      } else if (recoveredMessage) {
        await writeCodexAppServerDeliveredUserMessage(
          { store }, normalizedSessionId, recoveredMessage.displayMessage, receiptId,
          recoveredMessage.turnMetadata, recoveredMessage.displayAttachments,
          { threadId: normalizedThreadId, turnId: codexAppServerNotificationTurnId(notification) },
          recoveredMessage.data
        );
      }
      const turn = turnStateFromAgentRun(run || {});
      const providerTurnId = codexAppServerNotificationTurnId(notification);
      const providerTurnAlreadyTracked = normalizeText(turn.state) === "active" &&
        (!normalizedThreadId || normalizeText(turn.threadId) === normalizedThreadId) &&
        (!providerTurnId || normalizeText(turn.turnId) === providerTurnId);
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

  return Object.freeze({
    messageDeliveries: codexAppServerMessageDeliveries,
    pendingUserMessages: codexAppServerPendingUserMessages,
    pendingUserMessage,
    withMessageDelivery: withCodexAppServerMessageDelivery,
    writeDeliveredUserMessage: writeCodexAppServerDeliveredUserMessage,
    mirrorTerminalUserMessage: mirrorCodexAppServerTerminalUserMessage
  });
}

/** @typedef {ReturnType<typeof createCodexAppServerMessageDelivery>} CodexAppServerMessageDelivery */
