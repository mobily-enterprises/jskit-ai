import { computed, reactive, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { api } from "../services/api";
import { useAuthGuard } from "./useAuthGuard";
import { createDefaultAnnuityForm, modeOptions, timingOptions } from "../features/annuity/formModel";
import { buildAnnuityPayload, validateAnnuityForm } from "../features/annuity/request";
import { mapCalculationError } from "../features/annuity/errors";
import { formatCurrency, formatDate, inputSummary, resultSummary, resultWarnings, typeLabel } from "../features/annuity/presentation";

export function useAnnuityCalculatorForm({ onCalculated } = {}) {
  const { handleUnauthorizedError } = useAuthGuard();

  const form = reactive(createDefaultAnnuityForm());
  const calcError = ref("");
  const calcWarnings = ref([]);
  const result = ref(null);

  const calculateMutation = useMutation({
    mutationFn: (payload) => api.calculate(payload)
  });

  const calculating = computed(() => calculateMutation.isPending.value);

  async function calculate() {
    calcError.value = "";
    calcWarnings.value = [];

    const validation = validateAnnuityForm(form);
    if (!validation.ok) {
      calcError.value = validation.message;
      return;
    }

    try {
      const data = await calculateMutation.mutateAsync(buildAnnuityPayload(form));
      result.value = data;
      calcWarnings.value = Array.isArray(data.warnings) ? data.warnings : [];

      if (typeof onCalculated === "function") {
        await onCalculated(data);
      }
    } catch (error) {
      if (await handleUnauthorizedError(error)) {
        return;
      }

      calcError.value = mapCalculationError(error).message;
    }
  }

  function resetForm() {
    Object.assign(form, createDefaultAnnuityForm());
    calcError.value = "";
    calcWarnings.value = [];
    result.value = null;
  }

  const computedResultSummary = computed(() => resultSummary(result.value));
  const computedResultWarnings = computed(() => resultWarnings(result.value));

  return {
    modeOptions,
    timingOptions,
    form,
    calcError,
    calcWarnings,
    result,
    calculating,
    calculate,
    resetForm,
    formatCurrency,
    formatDate,
    typeLabel,
    inputSummary,
    resultSummary: computedResultSummary,
    resultWarnings: computedResultWarnings
  };
}
