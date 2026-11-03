// The refusals the conversation runtime gives its callers, and the error texts its saved state keeps.
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

/**
 * A refusal for the caller. code is its own value, or one a client branches on
 * shared with other sentences; messageCode names this sentence so a client can
 * show it in the user's language.
 */
function failure(message, code, statusCode = 409, { messageCode, messageParams } = {}) {
  return new AppError(statusCode, message, { code, ...(messageCode ? { messageCode, messageParams } : {}) });
}

/** A native delivery result keeps its own sentence and messageCode when it has one. */
function deliveryFailure(delivered) {
  const code = delivered?.code || "conversation_delivery_uncertain";
  return delivered?.error
    ? failure(delivered.error, code, 409, delivered)
    : failure("Native delivery could not be confirmed.", code, 409, { messageCode: "assistant.conversation.deliveryUnconfirmed" });
}

// Error texts that conversation state keeps, including saved records written by
// earlier releases and the API engine's turn failures. A snapshot or event names
// them so a client can show them in the user's language; any other error text is
// shown as sent.
const STATE_ERROR_MESSAGES = Object.freeze([
  { message: "This conversation exceeds the configured API history limit. Start another conversation or increase the limit.",
    messageCode: "assistant.conversation.apiHistoryLimit" },
  { message: "The model reached its output token limit before completing the answer. Increase maxOutputTokens in the conversation limits.",
    messageCode: "assistant.conversation.outputTokenLimit" },
  { message: "The model stream ended without confirming its application tool calls.", messageCode: "assistant.conversation.toolCallsUnconfirmed" },
  { message: "The model stream ended without confirming a completed answer.", messageCode: "assistant.conversation.answerUnconfirmed" },
  { message: "Application tool progress text exceeds the configured API limit.", messageCode: "assistant.conversation.toolProgressLimit" },
  { message: "The assistant exceeded the configured final reply limit.", messageCode: "assistant.conversation.finalReplyLimit" },
  { message: "Conversation updates exceed the configured history budget. Renew the context with a continuity briefing before continuing.",
    messageCode: "assistant.conversation.historyBudgetExceeded" },
  { message: "The continuity briefing exceeds the configured history budget.", messageCode: "assistant.conversation.briefingBudgetExceeded" },
  { message: "Assistant provider is not configured.", messageCode: "assistant.provider.notConfigured" },
  { message: "The previous submission was interrupted. Check delivery before submitting it again.",
    messageCode: "assistant.conversation.submissionInterrupted" },
  { message: "The application restarted before this answer completed. The request was not replayed.",
    messageCode: "assistant.conversation.restartInterrupted" },
  { message: "Copied into a stopped development environment. This request was not replayed.",
    messageCode: "assistant.conversation.copiedInterrupted" },
  { message: "The application operation result could not be saved. Restore storage access and retry saving.",
    messageCode: "assistant.conversation.operationResultUnsaved" },
  { message: "Conversation progress could not be saved. Restore access to its storage before continuing.",
    messageCode: "assistant.conversation.progressUnsaved" },
  { message: "The conversation request exceeded its time limit.", messageCode: "assistant.conversation.requestTimedOut" },
  { message: "Work stopped.", messageCode: "assistant.conversation.workStopped" },
  { message: "Stopped by user.", messageCode: "assistant.conversation.stoppedByUser" }
]);

function stateErrorFields(error) {
  const known = STATE_ERROR_MESSAGES.find(entry => entry.message === error);
  return known ? { errorMessageCode: known.messageCode, errorMessageParams: {} } : {};
}

export { deliveryFailure, failure, stateErrorFields };
