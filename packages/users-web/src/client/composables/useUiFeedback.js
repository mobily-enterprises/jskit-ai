import { ref } from "vue";
import { toUiErrorMessage } from "./errorMessageHelpers.js";

function useUiFeedback({ initialType = "success" } = {}) {
  const message = ref("");
  const messageType = ref(String(initialType || "success"));

  function clear() {
    message.value = "";
  }

  function success(nextMessage = "") {
    messageType.value = "success";
    message.value = String(nextMessage || "").trim();
  }

  function error(errorValue, fallbackMessage = "") {
    messageType.value = "error";
    message.value = toUiErrorMessage(errorValue, fallbackMessage, "Request failed.");
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
