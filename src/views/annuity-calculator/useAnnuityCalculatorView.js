import { reactive, ref } from "vue";

export function useAnnuityCalculatorView() {
  const historyRefreshToken = ref(0);

  function handleCalculated() {
    historyRefreshToken.value += 1;
  }

  return {
    state: reactive({
      historyRefreshToken
    }),
    actions: {
      handleCalculated
    }
  };
}
