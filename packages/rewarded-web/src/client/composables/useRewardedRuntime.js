import { inject } from "vue";
import { REWARDED_RUNTIME_INJECTION_KEY } from "../runtime/rewardedRuntime.js";

function useRewardedRuntime() {
  return inject(REWARDED_RUNTIME_INJECTION_KEY, null);
}

export { useRewardedRuntime };
