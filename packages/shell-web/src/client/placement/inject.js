import { inject } from "vue";
import { WEB_PLACEMENT_RUNTIME_INJECTION_KEY } from "./tokens.js";

const EMPTY_WEB_PLACEMENT_RUNTIME = Object.freeze({
  getPlacements() {
    return Object.freeze([]);
  }
});

function useWebPlacementRuntime({ required = false } = {}) {
  const runtime = inject(WEB_PLACEMENT_RUNTIME_INJECTION_KEY, null);
  if (runtime && typeof runtime.getPlacements === "function") {
    return runtime;
  }

  if (required) {
    throw new Error("Web placement runtime is not available in Vue injection context.");
  }

  return EMPTY_WEB_PLACEMENT_RUNTIME;
}

export {
  EMPTY_WEB_PLACEMENT_RUNTIME,
  useWebPlacementRuntime
};
