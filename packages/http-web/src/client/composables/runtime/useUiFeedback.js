import { ref } from "vue";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { toUiErrorMessage } from "../support/errorMessageHelpers.js";

/** @param {import("../../types.js").UiFeedbackOptions} [options] */
function useUiFeedback({
  initialType = "success",
  source = "http-web.ui-feedback",
  successChannel = "",
  warningChannel = "",
  errorChannel = "",
  dedupeWindowMs = 2000
} = {}) {
  const message = ref("");
  const messageType = ref(String(initialType || "success"));
  const errorRuntime = useShellWebErrorRuntime();
  const normalizedSource = String(source || "").trim() || "http-web.ui-feedback";
  let lastErrorPresentation = null;

  function rememberErrorPresentation(reportResult = null) {
    const presentationId = String(reportResult?.presentationId || "").trim();
    const presenterId = String(reportResult?.decision?.presenterId || "").trim();
    if (!presentationId || !presenterId) {
      return;
    }

    lastErrorPresentation = Object.freeze({
      presentationId,
      presenterId
    });
  }

  function dismissLastErrorPresentation() {
    if (!lastErrorPresentation) {
      return;
    }

    errorRuntime.dismiss(lastErrorPresentation.presentationId, {
      presenterId: lastErrorPresentation.presenterId
    });
    lastErrorPresentation = null;
  }

  function clear() {
    message.value = "";
  }

  // An action that did its work: a success, or a warning when it did it with a catch the person should act on.
  function reportDone(severity, channel, nextMessage) {
    messageType.value = severity;
    const normalizedMessage = String(nextMessage || "").trim();
    message.value = normalizedMessage;
    dismissLastErrorPresentation();
    if (!normalizedMessage) {
      return;
    }

    errorRuntime.report({
      source: normalizedSource,
      message: normalizedMessage,
      intent: "action-feedback",
      severity,
      channel,
      dedupeKey: `${normalizedSource}:${severity}:${normalizedMessage}`,
      dedupeWindowMs
    });
  }

  function success(nextMessage = "") {
    reportDone("success", successChannel, nextMessage);
  }

  function warning(nextMessage = "") {
    reportDone("warning", warningChannel, nextMessage);
  }

  function error(errorValue, fallbackMessage = "") {
    messageType.value = "error";
    message.value = toUiErrorMessage(errorValue, fallbackMessage);
    if (!message.value) {
      return;
    }

    const reportResult = errorRuntime.report({
      source: normalizedSource,
      message: message.value,
      cause: errorValue || null,
      intent: "action-feedback",
      severity: "error",
      channel: errorChannel,
      dedupeKey: `${normalizedSource}:error:${message.value}`,
      dedupeWindowMs
    });

    if (!reportResult?.skipped) {
      rememberErrorPresentation(reportResult);
    }
  }

  return {
    message,
    messageType,
    clear,
    success,
    warning,
    error
  };
}

export { useUiFeedback };
