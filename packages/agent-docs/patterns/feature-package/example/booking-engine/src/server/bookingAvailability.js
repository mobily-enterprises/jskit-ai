/**
 * The `feature.booking-engine.availability` default when no package provides
 * one: every scope takes bookings.
 * @type {import("./types.js").BookingEngineAvailability}
 */
async function everyScopeOpen() {
  return true;
}

export { everyScopeOpen };
