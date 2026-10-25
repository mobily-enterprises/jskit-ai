import { PaymentError } from "./service.js";

// Plan-to-price bindings shared by the provider adapters. `invalid` throws the
// adapter's own provider-result error for an unknown or ambiguous price.
function createPriceBindings({ priceBindings, historicalPriceBindings = {}, invalid }) {
  const prices = structuredClone(priceBindings);
  function validatePlan(planId) {
    if (!Object.hasOwn(prices, planId)) throw new PaymentError("payment_plan_unknown", "Select a published payment plan.");
  }
  function priceFor(planId) {
    validatePlan(planId);
    return prices[planId];
  }
  function planFor(priceId) {
    const matches = Object.entries(prices).filter(([, value]) => value === priceId);
    if (!matches.length && Object.hasOwn(historicalPriceBindings, priceId)) return historicalPriceBindings[priceId];
    if (matches.length !== 1) invalid();
    return matches[0][0];
  }
  return { validatePlan, priceFor, planFor };
}

export { createPriceBindings };
