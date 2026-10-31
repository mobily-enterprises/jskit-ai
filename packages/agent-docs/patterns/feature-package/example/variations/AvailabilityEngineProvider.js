import { defineFeature } from "@jskit-ai/kernel/server/features";
import { emptyInputValidator } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { createService } from "./orchestratorService.js";

/** @param {{ availabilityEngine: import("./types.js").AvailabilityEngine }} dependencies */
function createAvailabilityEngineActions({ availabilityEngine }) {
  return Object.freeze([
    Object.freeze({
      id: "availability.status.read",
      kind: "query",
      input: emptyInputValidator,
      idempotency: "none",
      execute: (input) => availabilityEngine.getStatus(input)
    })
  ]);
}

const AvailabilityEngineProvider = defineFeature({
  id: "feature.availability-engine",
  domain: "availability",
  provides: {
    availabilityEngine: "feature.availability-engine"
  },
  actionDefaults: {
    channels: ["api", "assistant", "internal"],
    surfaces: ["app"]
  },
  setup() {
    return { availabilityEngine: createService() };
  },
  actions({ availabilityEngine }) {
    return createAvailabilityEngineActions({ availabilityEngine });
  }
});

export { AvailabilityEngineProvider };
