// The booking engine: what the feature provides as `feature.booking-engine`.
function createBookingEngine() {
  // Reports the engine's status for the validated query.
  async function readStatus({ scope = "default", verbose = false }) {
    return {
      ok: true,
      feature: "booking-engine",
      scope,
      verbose
    };
  }

  return Object.freeze({ readStatus });
}

export { createBookingEngine };
