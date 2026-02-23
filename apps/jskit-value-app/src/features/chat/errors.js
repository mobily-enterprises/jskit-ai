function summarizeFieldErrors(fieldErrors) {
  if (!fieldErrors || typeof fieldErrors !== "object") {
    return "";
  }

  return Object.values(fieldErrors)
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
}

function mapChatCodeToMessage(errorCode) {
  switch (String(errorCode || "").trim().toUpperCase()) {
    case "CHAT_THREAD_NOT_FOUND":
      return "Thread not found or unavailable.";
    case "CHAT_SURFACE_INVALID":
      return "Chat is not available on this surface for the selected thread.";
    case "CHAT_IDEMPOTENCY_CONFLICT":
      return "Duplicate message id conflicts with different content.";
    case "CHAT_MESSAGE_RETRY_BLOCKED":
      return "That retry is blocked because the original message was deleted.";
    case "CHAT_READ_CURSOR_INVALID":
      return "Read cursor is invalid for this thread.";
    case "CHAT_RATE_LIMITED":
      return "You are sending too quickly. Try again in a moment.";
    case "CHAT_ATTACHMENT_NOT_FOUND":
      return "Attachment is unavailable.";
    case "CHAT_ATTACHMENT_CONFLICT":
      return "Attachment state changed. Try uploading again.";
    case "CHAT_ATTACHMENT_UPLOAD_IN_PROGRESS":
      return "Upload already in progress for this attachment.";
    default:
      return "";
  }
}

function mapChatError(error, fallbackMessage = "Unable to process chat request.") {
  const errorCode = String(error?.details?.code || "").trim().toUpperCase();
  const fieldSummary = summarizeFieldErrors(error?.fieldErrors);
  const codeMessage = mapChatCodeToMessage(errorCode);
  const message = fieldSummary || codeMessage || String(error?.message || fallbackMessage);

  return {
    message,
    errorCode,
    fieldErrorSummary: fieldSummary
  };
}

const __testables = {
  summarizeFieldErrors,
  mapChatCodeToMessage
};

export { mapChatError, __testables };
