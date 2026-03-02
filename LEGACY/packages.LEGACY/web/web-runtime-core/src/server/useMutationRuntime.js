import { computed, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";

function useMutationRuntime(options = {}) {
  const { mutationFn, handleUnauthorizedError, mapError, onSuccess, onError } = options;

  if (typeof mutationFn !== "function") {
    throw new Error("useMutationRuntime requires a mutationFn.");
  }

  const errorMessage = ref("");

  const mutation = useMutation({
    mutationFn: (payload) => mutationFn(payload),
    onSuccess: async (data, variables, context) => {
      errorMessage.value = "";
      if (typeof onSuccess === "function") {
        await onSuccess(data, variables, context);
      }
    },
    onError: async (error, variables, context) => {
      if (typeof handleUnauthorizedError === "function") {
        const handled = await handleUnauthorizedError(error);
        if (handled) {
          return;
        }
      }
      errorMessage.value = typeof mapError === "function"
        ? mapError(error)
        : String(error?.message || "Unable to submit request.");
      if (typeof onError === "function") {
        await onError(error, variables, context);
      }
    }
  });

  async function submit(payload) {
    errorMessage.value = "";
    return mutation.mutateAsync(payload);
  }

  return {
    state: {
      submitting: computed(() => Boolean(mutation.isPending?.value || mutation.isLoading?.value)),
      error: errorMessage
    },
    actions: {
      submit,
      reset: () => mutation.reset()
    }
  };
}

export { useMutationRuntime };
