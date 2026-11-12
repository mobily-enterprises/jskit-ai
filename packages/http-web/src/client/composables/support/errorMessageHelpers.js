import { isGenericHttpErrorMessage, resolveFieldErrors } from "@jskit-ai/http-runtime/client";
import { isRetryableLoadStatus, resolveLoadErrorStatus } from "./resourceLoadStateHelpers.js";
import { useJskitText } from "../../i18n.js";

const { t, text, serverMessage, fieldErrorMessages } = useJskitText();

// An error's message in the user's language: its code or messageCode when the
// English it carries is JSKIT's English for that code, otherwise as sent. A
// caller's specific fallback copy still wins over generic transport wording.
// Fallbacks may be message keys, rendered in the language active when shown.
function toUiErrorMessage(error, fallbackMessage = "", defaultMessage = "") {
  const normalizedFallback = text(fallbackMessage).trim();
  const normalizedMessage = String(error?.message || "").trim();
  if (normalizedMessage && !isGenericHttpErrorMessage(error)) {
    return serverMessage(error).trim();
  }
  if (normalizedFallback) {
    return normalizedFallback;
  }
  if (normalizedMessage) {
    return serverMessage(error).trim();
  }

  return text(defaultMessage).trim() || t("jskit.http.feedback.requestFailed");
}

function toQueryErrorMessage(error, fallbackMessage = "", defaultMessage = "") {
  return error ? toUiErrorMessage(error, fallbackMessage, defaultMessage) : "";
}

const LOAD_REFUSED_MESSAGE_KEYS = Object.freeze({
  401: "jskit.http.loadRefused.unauthorized",
  403: "jskit.http.loadRefused.forbidden",
  404: "jskit.http.loadRefused.notFound"
});

// What a screen says about a load the server refused (a status trying again cannot help, see
// isRetryableLoadStatus): the server's own message when the error carries one, as a load error shows it,
// otherwise a neutral text for the kind of refusal. Empty when there is no error or trying again may help.
function toLoadRefusalMessage(error) {
  const status = resolveLoadErrorStatus(error);
  if (!error || isRetryableLoadStatus(status)) {
    return "";
  }

  return toUiErrorMessage(error, LOAD_REFUSED_MESSAGE_KEYS[status] || "jskit.http.loadRefused.other");
}

// Field errors in the user's language, field by field under the same rule.
function toUiFieldErrors(error) {
  return fieldErrorMessages({
    fieldErrors: resolveFieldErrors(error),
    fieldErrorCodes: error?.fieldErrorCodes || error?.details?.fieldErrorCodes
  });
}

export {
  toLoadRefusalMessage,
  toQueryErrorMessage,
  toUiErrorMessage,
  toUiFieldErrors
};
