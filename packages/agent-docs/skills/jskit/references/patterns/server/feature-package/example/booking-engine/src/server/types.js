// The types of the `feature.booking-engine` capability and of its optional
// `feature.booking-engine.availability` slot.

/** @typedef {ReturnType<typeof import("./bookingEngine.js").createBookingEngine>} BookingEngine */

/**
 * The `feature.booking-engine.availability` slot: answers whether a scope takes
 * bookings. A package supplies it by providing that token.
 * @typedef {(scope: string) => Promise<boolean>} BookingEngineAvailability
 */

export {};
