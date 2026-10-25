import { isGenericHttpErrorMessage } from "@jskit-ai/http-runtime/client";

function toUiErrorMessage(error, fallbackMessage = "", defaultMessage = "Request failed.") {
  const normalizedFallback = String(fallbackMessage || "").trim();
  const normalizedMessage = String(error?.message || "").trim();
  if (normalizedMessage && !isGenericHttpErrorMessage(error)) {
    return normalizedMessage;
  }
  if (normalizedFallback) {
    return normalizedFallback;
  }
  if (normalizedMessage) {
    return normalizedMessage;
  }

  return String(defaultMessage || "Request failed.").trim();
}

function toQueryErrorMessage(error, fallbackMessage = "", defaultMessage = "Request failed.") {
  return error ? toUiErrorMessage(error, fallbackMessage, defaultMessage) : "";
}

export {
  toQueryErrorMessage,
  toUiErrorMessage
};
