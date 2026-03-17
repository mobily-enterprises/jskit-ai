import { ref } from "vue";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { toUiErrorMessage } from "./errorMessageHelpers.js";

function useUiFeedback({
  initialType = "success",
  source = "users-web.ui-feedback",
  successChannel = "snackbar",
  errorChannel = "banner",
  dedupeWindowMs = 2000
} = {}) {
  const message = ref("");
  const messageType = ref(String(initialType || "success"));
  const errorRuntime = useShellWebErrorRuntime();
  const normalizedSource = String(source || "").trim() || "users-web.ui-feedback";

  function clear() {
    message.value = "";
  }

  function success(nextMessage = "") {
    messageType.value = "success";
    const normalizedMessage = String(nextMessage || "").trim();
    message.value = normalizedMessage;
    if (!normalizedMessage) {
      return;
    }

    errorRuntime.report({
      source: normalizedSource,
      message: normalizedMessage,
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

    errorRuntime.report({
      source: normalizedSource,
      message: message.value,
      cause: errorValue || null,
      severity: "error",
      channel: errorChannel,
      dedupeKey: `${normalizedSource}:error:${message.value}`,
      dedupeWindowMs
    });
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
