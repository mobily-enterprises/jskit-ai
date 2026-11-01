/**
 * Who a booking-engine action runs for: the id of the action context's actor,
 * or null for an anonymous call. Every method of the package reads the actor
 * through this one helper.
 * @param {{ actor: { id: unknown } | null }} context
 */
function bookingRequester(context) {
  return context.actor?.id ?? null;
}

export { bookingRequester };
