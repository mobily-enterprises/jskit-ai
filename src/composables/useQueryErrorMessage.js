import { ref, watch } from "vue";

const DEFAULT_ERROR_MESSAGE = "Unable to load data.";

function resolveErrorMessage(error, mapError) {
  if (typeof mapError === "function") {
    const mapped = mapError(error);
    const mappedMessage = String(mapped?.message || "").trim();
    if (mappedMessage) {
      return mappedMessage;
    }
  }

  const directMessage = String(error?.message || "").trim();
  if (directMessage) {
    return directMessage;
  }

  return DEFAULT_ERROR_MESSAGE;
}

export function useQueryErrorMessage({ query, handleUnauthorizedError, mapError } = {}) {
  const error = ref("");

  watch(
    () => query?.error?.value,
    async (nextError) => {
      if (!nextError) {
        error.value = "";
        return;
      }

      if (typeof handleUnauthorizedError === "function") {
        const handled = await handleUnauthorizedError(nextError);
        if (handled) {
          return;
        }
      }

      error.value = resolveErrorMessage(nextError, mapError);
    }
  );

  return error;
}
