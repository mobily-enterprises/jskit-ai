function summarizeFieldErrors(fieldErrors) {
  if (!fieldErrors || typeof fieldErrors !== "object") {
    return "";
  }

  return Object.values(fieldErrors)
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
}

function mapSocialCodeToMessage(errorCode) {
  switch (
    String(errorCode || "")
      .trim()
      .toUpperCase()
  ) {
    case "SOCIAL_POST_NOT_FOUND":
      return "Post not found or unavailable.";
    case "SOCIAL_COMMENT_NOT_FOUND":
      return "Comment not found or unavailable.";
    case "SOCIAL_ACTOR_NOT_FOUND":
      return "Profile not found.";
    case "SOCIAL_FOLLOW_CONFLICT":
      return "Follow state changed. Refresh and retry.";
    case "SOCIAL_FEDERATION_SIGNATURE_INVALID":
      return "Federation signature validation failed.";
    case "SOCIAL_FEDERATION_FETCH_BLOCKED":
      return "Remote federation fetch was blocked by policy.";
    default:
      return "";
  }
}

function mapSocialError(error, fallbackMessage = "Unable to process social request.") {
  const errorCode = String(error?.details?.code || "")
    .trim()
    .toUpperCase();
  const fieldSummary = summarizeFieldErrors(error?.fieldErrors || error?.details?.fieldErrors);
  const codeMessage = mapSocialCodeToMessage(errorCode);
  const message = fieldSummary || codeMessage || String(error?.message || fallbackMessage);

  return {
    message,
    errorCode,
    fieldErrorSummary: fieldSummary
  };
}

const __testables = {
  summarizeFieldErrors,
  mapSocialCodeToMessage
};

export { mapSocialError, __testables };
