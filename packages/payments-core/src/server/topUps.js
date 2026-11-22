import { TOP_UP_RETURN_PARAMETER } from "../shared/topUps.js";
import { PaymentError } from "./errors.js";

// A prepaid top-up's statuses: written down before the provider hears of it (starting), its Checkout page open
// (open), paid but not cleared yet, as a bank payment is (processing), and the three it ends in: paid (credited to
// the application's balance), failed and expired.
const SETTLED_TOP_UP = Object.freeze(["paid", "failed", "expired"]);

// What each outcome the provider reports makes of each status; any other pair leaves the status as it is. Paid wins
// over every status, since the money was taken; failed and expired end only a top-up still waiting; processing only
// follows an open page. So reports arriving late, twice or out of order never undo an outcome.
const NEXT_TOP_UP_STATUS = Object.freeze({
  processing: Object.freeze({ open: "processing" }),
  failed: Object.freeze({ open: "failed", processing: "failed" }),
  expired: Object.freeze({ open: "expired" }),
  paid: Object.freeze({ open: "paid", processing: "paid", failed: "paid", expired: "paid" })
});

/**
 * The status a top-up moves to when the provider reports an outcome for it.
 * @param {string} status
 * @param {"open" | "processing" | "paid" | "failed" | "expired"} outcome
 */
function nextTopUpStatus(status, outcome) {
  const moves = Object.hasOwn(NEXT_TOP_UP_STATUS, outcome) ? NEXT_TOP_UP_STATUS[outcome] : {};
  return Object.hasOwn(moves, status) ? moves[status] : status;
}

/**
 * Checks the amount: a whole number of the currency's smallest unit within the application's limits.
 * @param {import("./types.js").PaymentTopUpOffer} offer
 * @param {unknown} amount
 */
function checkTopUpAmount(offer, amount) {
  if (!Number.isSafeInteger(amount) || amount < offer.minimumAmount || amount > offer.maximumAmount) {
    throw new PaymentError("payment_top_up_amount_invalid", "Choose a top-up amount within this application's limits, in the currency's smallest unit.", 422);
  }
}

/**
 * The application's return URL naming the top-up, where Checkout sends the person back, paid or not.
 * @param {string} returnUrl
 * @param {string} topUpId
 */
function topUpReturnUrl(returnUrl, topUpId) {
  const url = new URL(returnUrl);
  url.searchParams.set(TOP_UP_RETURN_PARAMETER, topUpId);
  return url.href;
}

/**
 * What the application and its page see of a top-up: no subject, request or provider ids, and the Checkout page only
 * while it is open.
 * @param {import("./types.js").PaymentTopUp} topUp
 */
function topUpView({ id, status, amount, currency, url }) {
  return {
    topUpId: id,
    status,
    amount,
    currency,
    url: status === "open" ? url : null
  };
}

/**
 * The top-ups a checkout service takes, checked: the validated configuration's offer, the application's credit
 * function, and a provider adapter and store that carry them; null for a service without top-ups.
 * @param {import("./types.js").PaymentTopUps | undefined} topUps
 * @param {import("./types.js").PaymentProviderAdapter} adapter
 * @param {import("./types.js").PaymentStore} store
 */
function composedTopUps(topUps, adapter, store) {
  if (topUps === undefined) return null;
  const offer = topUps?.offer;
  if (typeof offer?.currency !== "string" || !Number.isSafeInteger(offer.minimumAmount) || !Number.isSafeInteger(offer.maximumAmount) || typeof offer.name !== "string") {
    throw new TypeError("Supply topUps.offer, the validated configuration's top-ups: validatePaymentConfiguration(document).topUps.");
  }
  // readable-check: allow method-probe - input validation: the application passes the function that adds a paid top-up to its own balance
  if (typeof topUps.credit !== "function") {
    throw new TypeError("Supply topUps.credit, the application's function that adds a paid top-up to its balance.");
  }
  // readable-check: allow method-probe - input validation: only a provider adapter with one-off Checkout payments takes top-ups
  if (typeof adapter?.createTopUpCheckout !== "function") {
    throw new TypeError("Top-ups take Stripe Checkout payments: compose createStripePaymentAdapter; Paddle has no top-ups.");
  }
  // readable-check: allow method-probe - input validation: an application's own payment store may keep no top-ups
  if (typeof store?.withTopUp !== "function") {
    throw new TypeError("Top-ups need a store that keeps them: PaymentStoreFeature's payments.store, or a store with createTopUp, inspectTopUp and withTopUp.");
  }
  return Object.freeze({
    offer: Object.freeze({ ...offer }),
    credit: topUps.credit
  });
}

export { SETTLED_TOP_UP, checkTopUpAmount, composedTopUps, nextTopUpStatus, topUpReturnUrl, topUpView };
