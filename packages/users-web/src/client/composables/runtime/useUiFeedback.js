import { ref } from "vue";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { toUiErrorMessage } from "../support/errorMessageHelpers.js";

function useUiFeedback({
  initialType = "success",
  source = "users-web.ui-feedback",
  successChannel = "",
  errorChannel = "",
  dedupeWindowMs = 2000
} = {}) {
  const message = ref("");
  const messageType = ref(String(initialType || "success"));
  const errorRuntime = useShellWebErrorRuntime();
  const normalizedSource = String(source || "").trim() || "users-web.ui-feedback";
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

  function success(nextMessage = "") {
    messageType.value = "success";
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
      severity: "success",
      channel: successChannel,
      dedupeKey: `${normalizedSource}:success:${normalizedMessage}`,
      dedupeWindowMs
    });
  }

  function error(errorValue, fallbackMessage = "") {
    messageType.value = "error";
    message.value = toUiErrorMessage(errorValue, fallbackMessage, "Request failed.");
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

  return Object.freeze({
    message,
    messageType,
    clear,
    success,
    error
  });
}

export { useUiFeedback };
