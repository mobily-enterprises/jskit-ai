import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";

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
   * @param {{ context: object }} options
   */
  async function readStatus({ scope = "default", verbose = false }, { context }) {
    return {
      ok: true,
      feature: "booking-engine",
      scope,
      verbose,
      open: await availability(scope),
      requestedBy: resolveActorId(context)
    };
  }

  return Object.freeze({ readStatus });
}

export { createBookingEngine };
