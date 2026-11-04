import { inject } from "vue";
import { REWARDED_RUNTIME_INJECTION_KEY } from "../runtime/rewardedRuntime.js";

/** @returns {import("../types.js").RewardedRuntime} */
function useRewardedRuntime() {
  return inject(REWARDED_RUNTIME_INJECTION_KEY);
}

export { useRewardedRuntime };
