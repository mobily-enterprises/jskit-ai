import { ref } from "vue";

function toErrorMessage(error, fallbackMessage) {
  if (typeof fallbackMessage === "string" && fallbackMessage.trim()) {
    return fallbackMessage.trim();
  }

  return String(error?.message || "Request failed.").trim();
}

function useUsersWebUiFeedback({ initialType = "success" } = {}) {
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
    message.value = toErrorMessage(errorValue, fallbackMessage);
  }

  return Object.freeze({
    message,
    messageType,
    clear,
    success,
    error
  });
}

export { useUsersWebUiFeedback };
