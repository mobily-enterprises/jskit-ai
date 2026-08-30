import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createActions } from "./actions.js";

const BookingEngineProvider = defineFeature({
  id: "feature.booking-engine",
  domain: "booking",
  provides: {
    bookingEngine: "feature.booking-engine"
  },
  actionDefaults: {
    channels: ["api", "assistant", "internal"],
    surfaces: ["app"]
  },
  setup() {
    return {
      bookingEngine: Object.freeze({
        async readStatus(input = {}) {
          return {
            ok: true,
            feature: "booking-engine",
            scope: input.scope || "default",
            verbose: input.verbose === true
          };
        }
      })
    };
  },
  actions({ bookingEngine }) {
    return createActions({ bookingEngine });
  }
});

export { BookingEngineProvider };
