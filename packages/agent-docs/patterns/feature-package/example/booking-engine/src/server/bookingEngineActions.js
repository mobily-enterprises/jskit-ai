import { statusQueryInputValidator } from "./inputSchemas.js";

const ACTION_GET_STATUS = "feature.booking-engine.status.read";

/** The fields every booking query shares, spread first into each definition. */
const BOOKING_QUERY = Object.freeze({
  version: 1,
  kind: "query",
  channels: ["api", "assistant", "internal"],
  surfaces: ["app"]
});

/** @param {{ bookingEngine: import("./types.js").BookingEngine }} dependencies */
function createBookingEngineActions({ bookingEngine }) {
  return Object.freeze([
    Object.freeze({
      ...BOOKING_QUERY,
      id: ACTION_GET_STATUS,
      input: statusQueryInputValidator,
      output: null,
      execute: (input, context) => bookingEngine.readStatus(input, { context })
    })
  ]);
}

export { ACTION_GET_STATUS, createBookingEngineActions };
