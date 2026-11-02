import { emptyInputValidator } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";

const ACTION_GET_AVAILABILITY_STATUS = "availability.status.read";

/** The fields every availability query shares, spread first into each definition. */
const AVAILABILITY_QUERY = Object.freeze({
  version: 1,
  kind: "query",
  channels: ["api", "assistant", "internal"],
  surfaces: ["app"]
});

/** @param {{ availabilityEngine: import("./types.js").AvailabilityEngine }} dependencies */
function createAvailabilityEngineActions({ availabilityEngine }) {
  return Object.freeze([
    Object.freeze({
      ...AVAILABILITY_QUERY,
      id: ACTION_GET_AVAILABILITY_STATUS,
      input: emptyInputValidator,
      output: null,
      execute: (input) => availabilityEngine.getStatus(input)
    })
  ]);
}

export { ACTION_GET_AVAILABILITY_STATUS, createAvailabilityEngineActions };
