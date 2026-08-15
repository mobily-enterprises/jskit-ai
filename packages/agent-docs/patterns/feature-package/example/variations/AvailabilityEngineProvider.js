import { defineFeature } from "@jskit-ai/kernel/server/features";
import { emptyInputValidator } from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { createService } from "./orchestratorService.js";

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
    return [{
      id: "availability.status.read",
      kind: "query",
      input: emptyInputValidator,
      idempotency: "none",
      async execute(input) {
        return availabilityEngine.getStatus(input);
      }
    }];
  }
});

export { AvailabilityEngineProvider };
