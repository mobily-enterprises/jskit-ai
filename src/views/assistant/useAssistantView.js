import { computed, ref } from "vue";
import { api } from "../../services/api/index.js";

const ASSISTANT_STREAM_TIMEOUT_MS = 60_000;

function buildId(prefix = "id") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeToolName(value) {
  const normalized = normalizeText(value);
  return normalized || "tool";
}

function isConversationalMessage(message) {
  if (!message || typeof message !== "object") {
    return false;
  }

  const role = message.role;
  if (role !== "user" && role !== "assistant") {
    return false;
  }

  return String(message.kind || "chat") !== "tool_event";
}

function isHistoryEligibleMessage(message) {
  if (!isConversationalMessage(message)) {
    return false;
  }

  if (!normalizeText(message.text)) {
    return false;
  }

  if (message.role === "assistant") {
    return normalizeText(message.status).toLowerCase() === "done";
  }

  return true;
}

function buildHistory(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter(isHistoryEligibleMessage)
    .map((message) => ({
      role: message.role,
      content: String(message.text || "")
    }))
    .filter((message) => normalizeText(message.content));
}

function buildToolCallSummary(event) {
  const name = normalizeToolName(event?.name);
  return `Tool call: ${name}`;
}

function buildToolResultSummary(event) {
  const name = normalizeToolName(event?.name);
  const failed = event?.ok === false;
  if (failed) {
    const reason = normalizeText(event?.error?.message) || "Tool execution failed.";
    return `Tool result: ${name} failed (${reason})`;
  }

  return `Tool result: ${name} completed`;
}

export function useAssistantView() {
  const messages = ref([]);
  const input = ref("");
  const sendOnEnter = ref(true);
  const isStreaming = ref(false);
  const error = ref("");
  const pendingToolEvents = ref([]);
  const abortController = ref(null);

  const canSend = computed(() => !isStreaming.value && normalizeText(input.value).length > 0);

  function appendMessage(payload) {
    messages.value = [...messages.value, payload];
  }

  function findMessageById(messageId) {
    return messages.value.find((message) => message.id === messageId) || null;
  }

  function updateMessage(messageId, updater) {
    messages.value = messages.value.map((message) => {
      if (message.id !== messageId) {
        return message;
      }

      const patch = typeof updater === "function" ? updater(message) : updater;
      return {
        ...message,
        ...(patch && typeof patch === "object" ? patch : {})
      };
    });
  }

  function appendAssistantDelta(assistantMessageId, delta) {
    const textDelta = String(delta || "");
    if (!textDelta) {
      return;
    }

    updateMessage(assistantMessageId, (message) => ({
      text: `${String(message.text || "")}${textDelta}`,
      status: "streaming"
    }));
  }

  function finalizeAssistantMessage(assistantMessageId, text) {
    const normalizedText = String(text || "");
    updateMessage(assistantMessageId, (message) => ({
      text: normalizedText || String(message?.text || ""),
      status: "done"
    }));
  }

  function markAssistantError(assistantMessageId) {
    updateMessage(assistantMessageId, {
      status: "error"
    });
  }

  function markAssistantCanceled(assistantMessageId) {
    updateMessage(assistantMessageId, {
      status: "canceled"
    });
  }

  function appendToolTimelineMessage(eventType, eventPayload) {
    const text = eventType === "tool_call" ? buildToolCallSummary(eventPayload) : buildToolResultSummary(eventPayload);
    appendMessage({
      id: buildId("tool_message"),
      role: "assistant",
      kind: "tool_event",
      text,
      status: eventType
    });
  }

  function addPendingToolEvent(payload) {
    pendingToolEvents.value = [
      ...pendingToolEvents.value,
      {
        id: String(payload?.toolCallId || buildId("tool_call")),
        name: normalizeToolName(payload?.name),
        arguments: String(payload?.arguments || ""),
        status: "pending",
        result: null,
        error: null
      }
    ];
  }

  function resolvePendingToolEvent(payload) {
    const toolCallId = String(payload?.toolCallId || "").trim();
    if (!toolCallId) {
      return;
    }

    pendingToolEvents.value = pendingToolEvents.value.map((event) => {
      if (event.id !== toolCallId) {
        return event;
      }

      return {
        ...event,
        status: payload?.ok === false ? "failed" : "done",
        result: payload?.ok === false ? null : payload?.result,
        error: payload?.ok === false ? payload?.error || null : null
      };
    });
  }

  function cancelStream() {
    if (!abortController.value) {
      return;
    }

    abortController.value.abort();
  }

  function handleInputKeydown(event) {
    if (!sendOnEnter.value) {
      return;
    }

    if (
      event?.key === "Enter" &&
      event?.shiftKey !== true &&
      event?.ctrlKey !== true &&
      event?.metaKey !== true &&
      event?.altKey !== true
    ) {
      event.preventDefault();
      void sendMessage();
    }
  }

  async function sendMessage() {
    const normalizedInput = normalizeText(input.value);
    if (!normalizedInput || isStreaming.value) {
      return;
    }

    const history = buildHistory(messages.value);
    const messageId = buildId("message");
    const assistantMessageId = buildId("assistant");

    appendMessage({
      id: buildId("user"),
      role: "user",
      kind: "chat",
      text: normalizedInput,
      status: "done"
    });

    appendMessage({
      id: assistantMessageId,
      role: "assistant",
      kind: "chat",
      text: "",
      status: "streaming"
    });

    input.value = "";
    error.value = "";
    isStreaming.value = true;
    const streamAbortController = new AbortController();
    abortController.value = streamAbortController;
    let streamTimedOut = false;
    let streamEventCount = 0;
    let streamDone = false;
    const streamTimeoutHandle =
      typeof setTimeout === "function"
        ? setTimeout(() => {
            streamTimedOut = true;
            streamAbortController.abort();
          }, ASSISTANT_STREAM_TIMEOUT_MS)
        : null;

    try {
      await api.ai.streamChat(
        {
          messageId,
          input: normalizedInput,
          history
        },
        {
          signal: streamAbortController.signal,
          onEvent(event) {
            streamEventCount += 1;
            const eventType = normalizeText(event?.type).toLowerCase();

            if (eventType === "assistant_delta") {
              appendAssistantDelta(assistantMessageId, event?.delta);
              return;
            }

            if (eventType === "assistant_message") {
              finalizeAssistantMessage(assistantMessageId, event?.text);
              return;
            }

            if (eventType === "tool_call") {
              addPendingToolEvent(event);
              appendToolTimelineMessage("tool_call", event);
              return;
            }

            if (eventType === "tool_result") {
              resolvePendingToolEvent(event);
              appendToolTimelineMessage("tool_result", event);
              return;
            }

            if (eventType === "error") {
              error.value = normalizeText(event?.message) || "Assistant request failed.";
              markAssistantError(assistantMessageId);
              return;
            }

            if (eventType === "done") {
              streamDone = true;
              updateMessage(assistantMessageId, (message) => ({
                status: message.status === "error" ? "error" : "done"
              }));
            }
          }
        }
      );

      const assistantMessage = findMessageById(assistantMessageId);
      const assistantText = normalizeText(assistantMessage?.text);
      if (!assistantText) {
        if (streamEventCount < 1) {
          error.value = "Assistant stream returned no events.";
        } else if (!streamDone) {
          error.value = "Assistant stream ended before completion.";
        } else {
          error.value = "Assistant returned no output.";
        }
        markAssistantError(assistantMessageId);
      } else {
        updateMessage(assistantMessageId, (message) => ({
          status: message.status === "streaming" ? "done" : message.status
        }));
      }
    } catch (streamError) {
      if (streamTimedOut) {
        error.value = "Assistant request timed out.";
        markAssistantError(assistantMessageId);
      } else if (String(streamError?.name || "") !== "AbortError") {
        error.value = normalizeText(streamError?.message) || "Assistant request failed.";
        markAssistantError(assistantMessageId);
      } else {
        markAssistantCanceled(assistantMessageId);
      }
    } finally {
      if (streamTimeoutHandle != null && typeof clearTimeout === "function") {
        clearTimeout(streamTimeoutHandle);
      }
      abortController.value = null;
      isStreaming.value = false;
    }
  }

  function clearConversation() {
    cancelStream();
    messages.value = [];
    pendingToolEvents.value = [];
    input.value = "";
    error.value = "";
    isStreaming.value = false;
    abortController.value = null;
  }

  return {
    state: {
      messages,
      input,
      sendOnEnter,
      isStreaming,
      error,
      pendingToolEvents,
      abortController,
      canSend
    },
    actions: {
      sendMessage,
      handleInputKeydown,
      cancelStream,
      clearConversation
    }
  };
}

export const __testables = {
  ASSISTANT_STREAM_TIMEOUT_MS,
  buildHistory,
  buildId,
  normalizeToolName,
  buildToolCallSummary,
  buildToolResultSummary
};
