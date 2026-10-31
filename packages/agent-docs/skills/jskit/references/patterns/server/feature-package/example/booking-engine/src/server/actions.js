import { statusQueryInputValidator } from "./inputSchemas.js";

const ACTION_GET_STATUS = "feature.booking-engine.status.read";

/** @param {{ bookingEngine: import("./types.js").BookingEngine }} dependencies */
function createBookingEngineActions({ bookingEngine }) {
  return Object.freeze([
    Object.freeze({
      id: ACTION_GET_STATUS,
      version: 1,
      kind: "query",
      input: statusQueryInputValidator,
      output: null,
      idempotency: "none",
      execute: (input) => bookingEngine.readStatus(input)
    })
  ]);
}

export { ACTION_GET_STATUS, createBookingEngineActions };
