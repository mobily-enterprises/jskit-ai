// The types of the payment objects an application composes, for code that receives them.

/** @typedef {ReturnType<typeof import("./catalogue.js").createPaymentCatalogue>} PaymentCatalogue */
/** @typedef {ReturnType<typeof import("./checkout.js").createPaymentCheckoutService>} PaymentCheckoutService */
/** @typedef {ReturnType<typeof import("./readiness.js").createPaymentReadiness>} PaymentReadiness */
/** @typedef {ReturnType<typeof import("./service.js").createPaymentService>} PaymentService */
/** @typedef {ReturnType<typeof import("./knexStore.js").createKnexPaymentStore>} PaymentStore */
/** @typedef {ReturnType<typeof import("../shared/configuration.js").validatePaymentConfiguration>} PaymentConfiguration */

/**
 * A payment provider adapter: Stripe's or Paddle's, which offer the same operations.
 * @typedef {ReturnType<typeof import("./stripe.js").createStripePaymentAdapter> | ReturnType<typeof import("./paddle.js").createPaddlePaymentAdapter>} PaymentProviderAdapter
 */

export {};
