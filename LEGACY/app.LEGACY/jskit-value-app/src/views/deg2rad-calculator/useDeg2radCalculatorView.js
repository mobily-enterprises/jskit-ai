import { reactive, ref } from "vue";

export function useDeg2radCalculatorView() {
  const historyRefreshToken = ref(0);

  function handleCalculated() {
    historyRefreshToken.value += 1;
  }

  return {
    history: reactive({
      refreshToken: historyRefreshToken
    }),
    actions: {
      handleCalculated
    }
  };
}
