import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createAvailabilityEngineActions } from "./availabilityEngineActions.js";
import { createAvailabilityEngine } from "./orchestratorService.js";

const AvailabilityEngineFeature = defineFeature({
  id: "feature.availability-engine",
  domain: "availability",
  provides: {
    availabilityEngine: "feature.availability-engine"
  },
  setup() {
    return { availabilityEngine: createAvailabilityEngine() };
  },
  actions({ availabilityEngine }) {
    return createAvailabilityEngineActions({ availabilityEngine });
  }
});

export { AvailabilityEngineFeature };
