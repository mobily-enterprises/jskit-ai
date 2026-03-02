import { computed, reactive, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { api } from "../../platform/http/api/index.js";
import { useAuthGuard } from "../../modules/auth/useAuthGuard.js";
import { createDefaultDeg2radForm } from "../../modules/deg2rad/formModel.js";
import { buildDeg2radPayload, validateDeg2radForm } from "../../modules/deg2rad/request.js";
import { mapCalculationError } from "../../modules/deg2rad/errors.js";
import { resultSummary } from "../../modules/deg2rad/presentation.js";

const DEG2RAD_MUTATION_META = "deg2rad";

export function useDeg2radCalculatorForm({ onCalculated } = {}) {
  const { handleUnauthorizedError } = useAuthGuard();

  const form = reactive(createDefaultDeg2radForm());
  const error = ref("");
  const result = ref(null);

  const mutation = useMutation({
    mutationFn: (payload) => api.deg2rad.calculate(payload),
    meta: {
      calculator: DEG2RAD_MUTATION_META
    }
  });

  const calculating = computed(() => mutation.isPending.value);

  async function calculate() {
    error.value = "";

    const validation = validateDeg2radForm(form);
    if (!validation.ok) {
      error.value = validation.message;
      return;
    }

    try {
      const data = await mutation.mutateAsync(buildDeg2radPayload(form));
      result.value = data;

      if (typeof onCalculated === "function") {
        await onCalculated(data);
      }
    } catch (nextError) {
      if (await handleUnauthorizedError(nextError)) {
        return;
      }

      error.value = mapCalculationError(nextError).message;
    }
  }

  function resetForm() {
    Object.assign(form, createDefaultDeg2radForm());
    error.value = "";
    result.value = null;
  }

  return {
    meta: {},
    state: reactive({
      form,
      error,
      result,
      calculating,
      resultSummary: computed(() => resultSummary(result.value))
    }),
    actions: {
      calculate,
      resetForm
    }
  };
}
