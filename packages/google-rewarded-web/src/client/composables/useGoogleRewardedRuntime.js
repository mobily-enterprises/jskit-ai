import { inject } from "vue";
import { GOOGLE_REWARDED_RUNTIME_INJECTION_KEY } from "../runtime/googleRewardedRuntime.js";

function useGoogleRewardedRuntime() {
  return inject(GOOGLE_REWARDED_RUNTIME_INJECTION_KEY, null);
}

export { useGoogleRewardedRuntime };
