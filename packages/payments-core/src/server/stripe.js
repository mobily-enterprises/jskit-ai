import Stripe from "stripe";
import { APP_ENVIRONMENTS } from "@jskit-ai/kernel/shared/support/appEnvironment";
import { PaymentError } from "./errors.js";
import { createPriceBindings } from "./priceBindings.js";

const id = (value) => typeof value === "string" ? value : value?.id;
const invalid = () => {
  throw new PaymentError("payment_provider_result_invalid", "Check the Stripe account, price mapping and subscription shape.", 502, {
    messageCode: "payments.provider.checkAccount", messageParams: { provider: "Stripe" }
  });
};
const invalidTopUp = () => {
  throw new PaymentError("payment_provider_result_invalid", "Check the Stripe account and the top-up's Checkout session.", 502, {
    messageCode: "payments.provider.topUpSession"
  });
};
// A live secret or restricted key takes real money; only APP_ENV=production uses one. Test keys work everywhere.
const LIVE_KEY = /^(?:sk|rk)_live_/u;
// The Checkout session events of a top-up: paid now or later (a bank payment), waiting for a bank payment, its bank
// payment failed, and its page closed unpaid.
const TOP_UP_EVENTS = Object.freeze([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired"
]);
// What a payment-mode Checkout session's status and payment status say of its top-up.
const SESSION_OUTCOMES = Object.freeze({
  "open/unpaid": "open",
  "complete/paid": "paid",
  "complete/unpaid": "processing",
  "expired/unpaid": "expired"
});

/**
 * The Stripe SDK's settings: no automatic retries, and, given `apiBaseUrl`, requests to that stand-in for Stripe's
 * API instead of Stripe, which only development and tests take, so a test never reaches Stripe.
 * @param {string} appEnv
 * @param {string} apiBaseUrl
 */
function stripeClientSettings(appEnv, apiBaseUrl) {
  if (!apiBaseUrl) return { maxNetworkRetries: 0 };
  if (appEnv !== "development" && appEnv !== "test") {
    throw new PaymentError("payment_stand_in_refused", "A stand-in for Stripe's API works only in development and tests: remove apiBaseUrl in this environment.", 409);
  }
  const url = new URL(apiBaseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError("Give apiBaseUrl as the stand-in's origin alone, such as http://127.0.0.1:12111.");
  }
  return {
    maxNetworkRetries: 0,
    protocol: url.protocol.slice(0, -1),
    host: url.hostname,
    port: Number(url.port) || (url.protocol === "https:" ? 443 : 80)
  };
}

/**
 * @param {object} options
 * @param {string} [options.apiKey]
 * @param {"development" | "test" | "staging" | "production"} options.appEnv The application's APP_ENV
 *   (`appEnvironment(env)`). A live key (sk_live_, rk_live_) is refused unless it is production; test keys work in
 *   every environment.
 * @param {string} [options.apiBaseUrl] A stand-in for Stripe's API (its origin), for development and tests only.
 * @param {string} options.webhookSecret
 * @param {"sandbox" | "live"} options.environment
 * @param {string} options.providerAccountId
 * @param {Record<string, string>} options.priceBindings Each plan's current price id.
 * @param {Record<string, string>} [options.historicalPriceBindings] The plan of each retired price id.
 * @param {import("stripe").Stripe} [options.client]
 */
// readable-check: allow dependency-default - data: historicalPriceBindings maps retired price ids to plans, not a collaborator
function createStripePaymentAdapter({ apiKey, appEnv, apiBaseUrl = "", webhookSecret, environment, providerAccountId, priceBindings, historicalPriceBindings = {}, client = new Stripe(apiKey, stripeClientSettings(appEnv, apiBaseUrl)) }) {
  if (!APP_ENVIRONMENTS.includes(appEnv)) throw new TypeError("Supply appEnv, the application's APP_ENV: appEnvironment(env).");
  if (LIVE_KEY.test(String(apiKey ?? "")) && appEnv !== "production") {
    throw new PaymentError("payment_live_key_refused", "A live Stripe key takes real payments, and only APP_ENV=production takes them: use a test key (sk_test_ or rk_test_) in this environment.", 409);
  }
  if (!["sandbox", "live"].includes(environment) || typeof webhookSecret !== "string" || !webhookSecret || !providerAccountId) throw new TypeError("Supply Stripe credentials, environment and account identity.");
  const live = environment === "live";
  const { validatePlan, priceFor, planFor } = createPriceBindings({ priceBindings, historicalPriceBindings, invalid });
  async function verifyAccount() {
    const account = await client.accounts.retrieve();
    const balance = await client.balance.retrieve();
    if (account.id !== providerAccountId || balance.livemode !== live) invalid();
    return { accountId: account.id, environment, chargesEnabled: account.charges_enabled === true, payoutsEnabled: account.payouts_enabled === true };
  }
  async function verifyEvent(rawBody, signature) {
    if (!Buffer.isBuffer(rawBody)) throw new PaymentError("payment_signature_invalid", "Supply the unmodified webhook request bytes.", 400, { messageCode: "payments.webhook.rawBodyRequired" });
    let event;
    try { event = client.webhooks.constructEvent(rawBody, signature, webhookSecret); }
    catch { throw new PaymentError("payment_signature_invalid", "Stripe webhook verification failed.", 400, {
      messageCode: "payments.webhook.verificationFailed", messageParams: { provider: "Stripe" }
    }); }
    if (event.livemode !== live || (event.account && event.account !== providerAccountId)) invalid();
    return event;
  }
  function eventIdentity(event) {
    if (["invoice.paid", "invoice.payment_failed", "invoice.payment_action_required"].includes(event.type)) {
      const invoice = event.data?.object;
      // A signed standalone invoice has no subscription parent. Ignore it before
      // looking up an app customer; it does not belong to this billing contract.
      if (invoice?.parent === null) return null;
      if (!id(invoice?.parent?.subscription_details?.subscription)) invalid();
    } else if (!event.type?.startsWith("customer.subscription.")) return null;
    const customerId = id(event.data?.object?.customer);
    if (!event.id || !customerId) invalid();
    return { eventId: event.id, customerId };
  }
  async function loadEvent(event) {
    await verifyAccount();
    let invoice = null;
    let subscriptionId;
    if (["invoice.paid", "invoice.payment_failed", "invoice.payment_action_required"].includes(event.type)) {
      invoice = await client.invoices.retrieve(event.data.object.id);
      subscriptionId = id(invoice.parent?.subscription_details?.subscription);
      if (!subscriptionId) return null;
    } else if (event.type.startsWith("customer.subscription.")) {
      subscriptionId = event.data.object.id;
    } else return null;
    const subscription = await client.subscriptions.retrieve(subscriptionId);
    if (subscription.livemode !== live || subscription.items?.has_more || subscription.items?.data?.length !== 1) invalid();
    const item = subscription.items.data[0];
    if (item.quantity !== 1) invalid();
    const result = {
      subscription: { id: subscription.id, status: subscription.status, planId: planFor(item.price.id), periodEnd: item.current_period_end * 1000 }
    };
    if (invoice && (invoice.livemode !== live || id(invoice.customer) !== id(subscription.customer))) invalid();
    if (invoice?.status === "paid" && ["subscription_create", "subscription_cycle"].includes(invoice.billing_reason)) {
      if (invoice.lines?.has_more || invoice.lines?.data?.length !== 1) invalid();
      const line = invoice.lines.data[0];
      if (line.quantity !== 1 || line.parent?.subscription_item_details?.proration !== false) invalid();
      result.renewal = { id: invoice.id, planId: planFor(id(line.pricing?.price_details?.price)), periodEnd: line.period.end * 1000 };
    }
    return { customerId: id(subscription.customer), ...result };
  }
  async function createCustomer({ email, requestId }) {
    await verifyAccount();
    const customer = await client.customers.create({ email }, { idempotencyKey: requestId });
    return customer.id;
  }
  async function createCheckout({ customerId, planId, returnUrl, requestId }) {
    const price = priceFor(planId);
    await verifyAccount();
    const result = await client.checkout.sessions.create({ mode: "subscription", customer: customerId,
      line_items: [{ price, quantity: 1 }], success_url: returnUrl, cancel_url: returnUrl
    }, { idempotencyKey: requestId });
    if (typeof result.url !== "string") invalid();
    return { id: result.id, url: result.url };
  }
  async function createPortal({ customerId, returnUrl }) {
    await verifyAccount();
    const result = await client.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return { id: result.id, url: result.url };
  }
  async function readHistory({ customerId, collection, after = null }) {
    if (!["subscriptions", "transactions"].includes(collection)) throw new PaymentError("payment_input_invalid", "Select a billing history collection.", 422, { messageCode: "payments.input.historyCollection" });
    await verifyAccount();
    const query = { customer: customerId, limit: 20, ...(after ? { starting_after: after } : {}) };
    const page = collection === "subscriptions"
      ? await client.subscriptions.list({ ...query, status: "all" })
      : await client.invoices.list(query);
    if (!Array.isArray(page.data) || page.data.length > 20 || typeof page.has_more !== "boolean" || (page.has_more && !page.data.length)) invalid();
    const items = page.data.map((value) => {
      if (id(value.customer) !== customerId || value.livemode !== live || typeof value.id !== "string" ||
        typeof value.status !== "string" || !Number.isSafeInteger(value.created)) invalid();
      const base = { id: value.id, kind: collection === "subscriptions" ? "subscription" : "invoice",
        status: value.status, createdAt: new Date(value.created * 1000).toISOString() };
      if (collection === "subscriptions") return base;
      if (!Number.isSafeInteger(value.total) || !Number.isSafeInteger(value.amount_paid) ||
        typeof value.currency !== "string" || !/^[a-z]{3}$/.test(value.currency)) invalid();
      return { ...base, currency: value.currency.toUpperCase(), totalMinor: String(value.total), paidMinor: String(value.amount_paid) };
    });
    return { collection, items, nextCursor: page.has_more ? items.at(-1).id : null };
  }
  async function readProduct(productId) {
    await verifyAccount();
    const value = await client.products.retrieve(productId);
    return { id: value.id, name: value.name };
  }
  async function createProduct({ name, requestId }) {
    await verifyAccount();
    return client.products.create({ name }, { idempotencyKey: requestId });
  }
  async function renameProduct({ id, name, requestId }) {
    await verifyAccount();
    return client.products.update(id, { name }, { idempotencyKey: requestId });
  }
  async function readPrice(priceId) {
    await verifyAccount();
    const value = await client.prices.retrieve(priceId);
    if (value.recurring?.interval_count !== 1 || value.billing_scheme !== "per_unit") invalid();
    return { id: value.id, productId: id(value.product), amount: value.unit_amount, currency: value.currency.toUpperCase(), interval: value.recurring.interval, active: value.active };
  }
  /** @param {{ productId: string, amount: number, currency: string, interval: string, requestId: string }} price */
  async function createPrice({ productId, amount, currency, interval, requestId }) {
    await verifyAccount();
    return client.prices.create({ product: productId, unit_amount: amount, currency: currency.toLowerCase(), recurring: { interval } }, { idempotencyKey: requestId });
  }
  // What a top-up's Checkout session says: whose top-up it names (client_reference_id, a pointer the application's
  // own record must confirm), the outcome, and what was paid.
  function topUpFacts(session) {
    const outcome = SESSION_OUTCOMES[`${session?.status}/${session?.payment_status}`];
    if (session?.object !== "checkout.session" || session.mode !== "payment" || session.livemode !== live ||
      typeof session.id !== "string" || typeof outcome !== "string") invalidTopUp();
    return {
      topUpId: String(session.client_reference_id ?? ""),
      sessionId: session.id,
      outcome,
      amount: session.amount_total,
      currency: String(session.currency ?? "").toUpperCase(),
      paymentIntentId: id(session.payment_intent) ?? null
    };
  }
  /**
   * A one-off Checkout payment for a top-up: one line at the chosen amount, in payment mode, coming back to the
   * application's return URL paid or not. The same request id answers the same session however often it is sent.
   * @param {{ topUpId: string, amount: number, currency: string, name: string, description: string | null, email: string | null, returnUrl: string, requestId: string }} request
   */
  async function createTopUpCheckout({ topUpId, amount, currency, name, description, email, returnUrl, requestId }) {
    await verifyAccount();
    const tags = { jskit_top_up: topUpId };
    const result = await client.checkout.sessions.create({
      mode: "payment",
      client_reference_id: topUpId,
      line_items: [{ quantity: 1, price_data: { currency: currency.toLowerCase(), unit_amount: amount, product_data: { name, ...(description ? { description } : {}) } } }],
      ...(email ? { customer_email: email } : {}),
      // Stripe's receipt goes to the person who paid.
      payment_intent_data: { metadata: tags, ...(email ? { receipt_email: email } : {}) },
      metadata: tags,
      success_url: returnUrl,
      cancel_url: returnUrl
    }, { idempotencyKey: requestId });
    if (typeof result.id !== "string" || typeof result.url !== "string") invalidTopUp();
    return { id: result.id, url: result.url };
  }
  /** The top-up facts of a Checkout session, read from Stripe with this adapter's own key. */
  async function retrieveTopUpCheckout(sessionId) {
    return topUpFacts(await client.checkout.sessions.retrieve(sessionId));
  }
  /**
   * The top-up facts a verified event carries, or null for an event that is not a payment-mode Checkout session
   * naming a top-up. A failed bank payment leaves its session complete and unpaid, so the event's type says it failed.
   * @param {any} event
   */
  function topUpEvent(event) {
    const session = event?.data?.object;
    // A top-up's session names its top-up twice (see createTopUpCheckout); a Checkout payment of anything else does not.
    if (!TOP_UP_EVENTS.includes(event?.type) || session?.mode !== "payment" || typeof session.client_reference_id !== "string" ||
      session.metadata?.jskit_top_up !== session.client_reference_id) return null;
    const facts = topUpFacts(session);
    return event.type === "checkout.session.async_payment_failed" ? { ...facts, outcome: "failed" } : facts;
  }
  return Object.freeze({
    validatePlan,
    verifyAccount,
    verifyEvent,
    eventIdentity,
    loadEvent,
    createCustomer,
    createCheckout,
    createPortal,
    createTopUpCheckout,
    retrieveTopUpCheckout,
    topUpEvent,
    readHistory,
    readProduct,
    createProduct,
    renameProduct,
    readPrice,
    createPrice
  });
}

export { createStripePaymentAdapter };
