import { computed, reactive, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { api } from "../../services/api/index.js";
import { useAuthGuard } from "../../composables/useAuthGuard";
import { createDefaultAnnuityForm, modeOptions, timingOptions } from "../../features/annuity/formModel";
import { buildAnnuityPayload, validateAnnuityForm } from "../../features/annuity/request";
import { mapCalculationError } from "../../features/annuity/errors";
import { resultSummary, resultWarnings } from "../../features/annuity/presentation";

export function useAnnuityCalculatorForm({ onCalculated } = {}) {
  const { handleUnauthorizedError } = useAuthGuard();

  const form = reactive(createDefaultAnnuityForm());
  const error = ref("");
  const warnings = ref([]);
  const result = ref(null);

  const mutation = useMutation({
    mutationFn: (payload) => api.calculateAnnuity(payload)
  });

  const calculating = computed(() => mutation.isPending.value);

  async function calculate() {
    error.value = "";
    warnings.value = [];

    const validation = validateAnnuityForm(form);
    if (!validation.ok) {
      error.value = validation.message;
      return;
    }

    try {
      const data = await mutation.mutateAsync(buildAnnuityPayload(form));
      result.value = data;
      warnings.value = Array.isArray(data.warnings) ? data.warnings : [];

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
    Object.assign(form, createDefaultAnnuityForm());
    error.value = "";
    warnings.value = [];
    result.value = null;
  }

  return {
    meta: {
      modeOptions,
      timingOptions
    },
    state: reactive({
      form,
      error,
      warnings,
      result,
      calculating,
      resultSummary: computed(() => resultSummary(result.value)),
      resultWarnings: computed(() => resultWarnings(result.value))
    }),
    actions: {
      calculate,
      resetForm
    }
  };
}
