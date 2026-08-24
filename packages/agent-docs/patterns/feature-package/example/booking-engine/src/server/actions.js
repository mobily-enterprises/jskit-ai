import { statusQueryInputValidator } from "./inputSchemas.js";

const ACTION_GET_STATUS = "feature.booking-engine.status.read";
function createActions({ bookingEngine } = {}) {
  if (!bookingEngine || typeof bookingEngine.readStatus !== "function") {
    throw new TypeError("createActions requires bookingEngine.readStatus().");
  }

  return Object.freeze([
    {
      id: ACTION_GET_STATUS,
      version: 1,
      kind: "query",
      input: statusQueryInputValidator,
      output: null,
      idempotency: "none",
      audit: { actionName: ACTION_GET_STATUS },
      observability: {},
      async execute(input) {
        return bookingEngine.readStatus(input);
      }
    }
  ]);
}

export { ACTION_GET_STATUS, createActions };
