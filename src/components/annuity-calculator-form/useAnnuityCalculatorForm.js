import { computed, reactive, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { api } from "../../services/api/index.js";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { createDefaultAnnuityForm, modeOptions, timingOptions } from "../../features/annuity/formModel.js";
import { buildAnnuityPayload, validateAnnuityForm } from "../../features/annuity/request.js";
import { mapCalculationError } from "../../features/annuity/errors.js";
import { resultSummary, resultWarnings } from "../../features/annuity/presentation.js";

export function useAnnuityCalculatorForm({ onCalculated } = {}) {
  const { handleUnauthorizedError } = useAuthGuard();

  const form = reactive(createDefaultAnnuityForm());
  const error = ref("");
  const warnings = ref([]);
  const result = ref(null);
  const calculateAnnuity = (payload) =>
    typeof api?.annuity?.calculate === "function" ? api.annuity.calculate(payload) : api.calculateAnnuity(payload);

  const mutation = useMutation({
    mutationFn: (payload) => calculateAnnuity(payload)
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
