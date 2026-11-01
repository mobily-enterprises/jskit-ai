import { defineFeature } from "@jskit-ai/kernel/server/features";
import { everyScopeOpen } from "./bookingAvailability.js";
import { createBookingEngine } from "./bookingEngine.js";
import { createBookingEngineActions } from "./bookingEngineActions.js";

const BookingEngineFeature = defineFeature({
  id: "feature.booking-engine",
  domain: "booking",
  optional: {
    availability: "feature.booking-engine.availability"
  },
  provides: {
    bookingEngine: "feature.booking-engine"
  },
  actionDefaults: {
    channels: ["api", "assistant", "internal"],
    surfaces: ["app"]
  },
  /** @param {{ availability: import("./types.js").BookingEngineAvailability | null }} capabilities */
  setup({ availability }) {
    return { bookingEngine: createBookingEngine({ availability: availability ?? everyScopeOpen }) };
  },
  actions({ bookingEngine }) {
    return createBookingEngineActions({ bookingEngine });
  }
});

export { BookingEngineFeature };
