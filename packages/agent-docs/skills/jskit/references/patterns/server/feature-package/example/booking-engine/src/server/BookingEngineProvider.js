import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createBookingEngineActions } from "./actions.js";
import { createBookingEngine } from "./bookingEngine.js";

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
    return { bookingEngine: createBookingEngine() };
  },
  actions({ bookingEngine }) {
    return createBookingEngineActions({ bookingEngine });
  }
});

export { BookingEngineProvider };
