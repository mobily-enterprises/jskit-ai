import { bookingRequester } from "./bookingRequester.js";

/**
 * The booking engine the feature provides as `feature.booking-engine`.
 * @param {object} dependencies
 * @param {import("./types.js").BookingEngineAvailability} dependencies.availability
 */
function createBookingEngine({ availability }) {
  /**
   * Reports, for the validated query, whether its scope takes bookings and who
   * asked.
   * @param {{ scope?: string, verbose?: boolean }} query
   * @param {{ context: { actor: { id: unknown } | null } }} options
   */
  async function readStatus({ scope = "default", verbose = false }, { context }) {
    return {
      ok: true,
      feature: "booking-engine",
      scope,
      verbose,
      open: await availability(scope),
      requestedBy: bookingRequester(context)
    };
  }

  return Object.freeze({ readStatus });
}

export { createBookingEngine };
