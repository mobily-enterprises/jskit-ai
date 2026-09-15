import { normalizeObject, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  MAX_HISTORY_MESSAGES,
  MAX_INPUT_CHARS,
  parseJsonObject
} from "@jskit-ai/assistant-core/shared";
import { isAssistantProgressOnlyText } from "../../shared/assistantResponseText.js";
import { conversationTurnsFromMessages } from "@jskit-ai/assistant-core/shared/conversation";

const CONVERSATION_MESSAGE_STATUS = Object.freeze({
  streaming: "inProgress",
  done: "completed",
  error: "failed",
  canceled: "interrupted"
});

function mapAssistantConversationTurns(messages, toolEvents = [], { showToolActivity = true } = {}) {
  return conversationTurnsFromMessages(messages.map((message) => ({
    ...message,
    messageId: String(message.id),
    status: CONVERSATION_MESSAGE_STATUS[message.status],
    progressUpdates: showToolActivity ? toolEvents
      .filter((event) => event.messageId === message.id)
      .map((event) => ({ id: event.id, text: `${event.name} — ${event.status}` })) : []
  })));
}

function buildId(prefix = "id") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeToolName(value) {
  return normalizeText(value) || "tool";
}

function buildHistory(messages) {
  const normalizedHistory = (Array.isArray(messages) ? messages : [])
    .filter((message) => {
      if (!message || typeof message !== "object") {
        return false;
      }
      if (message.kind !== "chat") {
        return false;
      }
      if (message.role !== "user" && message.role !== "assistant") {
        return false;
      }
      if (normalizeText(message.status).toLowerCase() !== "done") {
        return false;
      }
      const text = normalizeText(message.text);
      if (!text) {
        return false;
      }
      return message.role !== "assistant" || !isAssistantProgressOnlyText(text);
    })
    .map((message) => ({
      role: message.role,
      content: String(message.text || "").slice(0, MAX_INPUT_CHARS),
      ...(message.role === "user" && message.attachments?.length ? { attachmentIds: message.attachments.map(file => file.attachmentId) } : {})
    }));

  return normalizedHistory.slice(-MAX_HISTORY_MESSAGES);
}

function interruptPendingToolEvents(toolEvents) {
  return (Array.isArray(toolEvents) ? toolEvents : []).map((toolEvent) => {
    if (normalizeText(toolEvent?.status).toLowerCase() !== "pending") {
      return toolEvent;
    }

    return {
      ...toolEvent,
      status: "interrupted"
    };
  });
}

function mapTranscriptEntriesToAssistantState(entries) {
  const sourceEntries = Array.isArray(entries) ? entries : [];
  const messages = [];
  const toolEventsById = new Map();
  let latestUserId = null;
  let currentAssistantId = null;
  const pendingAssociation = [];

  function ensureToolEvent(toolCallId, toolName) {
    const key = normalizeText(toolCallId) || buildId("tool_call");
    if (toolEventsById.has(key)) {
      return toolEventsById.get(key);
    }

    const next = {
      id: key,
      name: normalizeToolName(toolName),
      arguments: "",
      status: "pending",
      result: null,
      error: null
    };
    toolEventsById.set(key, next);
    return next;
  }

  for (const entry of sourceEntries) {
    const role = normalizeText(entry?.role).toLowerCase();
    const kind = normalizeText(entry?.kind).toLowerCase();
    const metadata = normalizeObject(entry?.metadata);
    const transcriptId = normalizeRecordId(entry?.id, { fallback: null });
    const messageId = transcriptId ? `transcript_${transcriptId}` : buildId("transcript");

    if (kind === "chat" && (role === "user" || role === "assistant")) {
      const text = entry?.contentText == null ? "" : String(entry.contentText);
      if (role === "assistant" && isAssistantProgressOnlyText(text)) {
        continue;
      }

      messages.push({
        id: messageId,
        role,
        kind: "chat",
        text,
        ...(Array.isArray(metadata.attachments) ? { attachments: metadata.attachments } : {}),
        status: "done"
      });
      if (role === "user") {
        latestUserId = messageId;
        currentAssistantId = null;
        pendingAssociation.length = 0;
      } else {
        currentAssistantId = messageId;
        for (const event of pendingAssociation) event.messageId = messageId;
        pendingAssociation.length = 0;
      }
      continue;
    }

    if (kind === "tool_call") {
      const toolCallId = normalizeText(metadata.toolCallId) || `tool_call_${messageId}`;
      const toolEvent = ensureToolEvent(toolCallId, metadata.tool);
      toolEvent.arguments = String(entry?.contentText || "");
      toolEvent.status = "pending";
      toolEvent.messageId = currentAssistantId || latestUserId;
      pendingAssociation.push(toolEvent);
      continue;
    }

    if (kind === "tool_result") {
      const parsedResult = parseJsonObject(entry?.contentText);
      const toolCallId = normalizeText(metadata.toolCallId || parsedResult.toolCallId) || `tool_result_${messageId}`;
      const toolEvent = ensureToolEvent(toolCallId, metadata.tool || parsedResult.tool);
      const failed = parsedResult.ok === false || metadata.ok === false;
      toolEvent.status = failed ? "failed" : "done";
      toolEvent.result = failed ? null : parsedResult.result;
      toolEvent.error = failed ? parsedResult.error || metadata.error || null : null;
    }
  }

  return {
    messages,
    pendingToolEvents: interruptPendingToolEvents([...toolEventsById.values()])
  };
}

export {
  buildHistory,
  buildId,
  interruptPendingToolEvents,
  mapTranscriptEntriesToAssistantState,
  mapAssistantConversationTurns,
  normalizeToolName
};
