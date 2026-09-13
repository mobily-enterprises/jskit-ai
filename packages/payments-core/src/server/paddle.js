import { Paddle, Environment } from "@paddle/paddle-node-sdk";
import { PaymentError } from "./service.js";

const invalid = () => { throw new PaymentError("payment_provider_result_invalid", "Check the Paddle account, price mapping and subscription shape.", 502); };

function createPaddlePaymentAdapter({ apiKey, webhookSecret, environment, priceBindings, taxCategory, historicalPriceBindings = {}, client = new Paddle(apiKey, { environment: environment === "live" ? Environment.production : Environment.sandbox }) }) {
  if (!["sandbox", "live"].includes(environment) || typeof webhookSecret !== "string" || !webhookSecret) throw new TypeError("Supply Paddle credentials and environment.");
  const prices = structuredClone(priceBindings);
  const planFor = (priceId) => {
    const matches = Object.entries(prices).filter(([, value]) => value === priceId);
    if (!matches.length && Object.hasOwn(historicalPriceBindings, priceId)) return historicalPriceBindings[priceId];
    if (matches.length !== 1) invalid();
    return matches[0][0];
  };
  function validatePlan(planId) {
    if (!Object.hasOwn(prices, planId)) throw new PaymentError("payment_plan_unknown", "Select a published payment plan.");
  }
  async function verifyAccount() {
    await client.products.list({ perPage: 1 }).next();
    // A successful catalogue read cannot prove merchant verification or identify
    // the legal account. Keep those readiness checks explicit in the UI.
    return { environment, credentialsVerified: true, accountIdentityVerified: false, merchantApproval: "manual-check-required" };
  }
  async function verifyEvent(rawBody, signature) {
    if (!Buffer.isBuffer(rawBody)) throw new PaymentError("payment_signature_invalid", "Supply the unmodified webhook request bytes.", 400);
    try { return await client.webhooks.unmarshal(rawBody.toString("utf8"), webhookSecret, signature); }
    catch { throw new PaymentError("payment_signature_invalid", "Paddle webhook verification failed.", 400); }
  }
  function eventIdentity(event) {
    if (event.eventType === "transaction.completed") {
      if (event.data?.subscriptionId === null) return null;
      if (!event.data?.subscriptionId) invalid();
    } else if (!event.eventType?.startsWith("subscription.")) return null;
    if (!event.eventId || !event.data?.customerId) invalid();
    return { eventId: event.eventId, customerId: event.data.customerId };
  }
  async function loadEvent(event) {
    let transaction = null;
    let subscriptionId;
    if (event.eventType === "transaction.completed") {
      transaction = await client.transactions.get(event.data.id);
      subscriptionId = transaction.subscriptionId;
      if (!subscriptionId) return null;
    } else if (event.eventType.startsWith("subscription.")) subscriptionId = event.data.id;
    else return null;
    const subscription = await client.subscriptions.get(subscriptionId);
    if (subscription.items?.length !== 1 || subscription.items[0].quantity !== 1) invalid();
    const result = { subscription: {
      id: subscription.id, status: subscription.status, planId: planFor(subscription.items[0].price.id),
      periodEnd: subscription.currentBillingPeriod ? Date.parse(subscription.currentBillingPeriod.endsAt) : 0
    } };
    if (transaction && transaction.customerId !== subscription.customerId) invalid();
    if (transaction?.status === "completed" && ["api", "web", "subscription_recurring"].includes(transaction.origin)) {
      if (transaction.items?.length !== 1 || transaction.items[0].quantity !== 1 || transaction.items[0].proration || !transaction.billingPeriod) invalid();
      result.renewal = { id: transaction.id, planId: planFor(transaction.items[0].price?.id), periodEnd: Date.parse(transaction.billingPeriod.endsAt) };
    }
    return { customerId: subscription.customerId, ...result };
  }
  async function createCustomer({ email }) {
    const customer = await client.customers.create({ email });
    return customer.id;
  }
  async function createCheckout({ customerId, planId, returnUrl }) {
    if (!Object.hasOwn(prices, planId)) throw new PaymentError("payment_plan_unknown", "Select a published payment plan.");
    // This URL is an app-owned Paddle.js checkout page, approved in Paddle.
    const result = await client.transactions.create({ customerId, collectionMode: "automatic",
      items: [{ priceId: prices[planId], quantity: 1 }], checkout: { url: returnUrl } });
    if (typeof result.checkout?.url !== "string") invalid();
    return { id: result.id, url: result.checkout.url };
  }
  async function createPortal({ customerId }) {
    const result = await client.customerPortalSessions.create(customerId, []);
    return { id: result.id, url: result.urls.general.overview };
  }
  async function readHistory({ customerId, collection, after = null }) {
    if (!["subscriptions", "transactions"].includes(collection)) throw new PaymentError("payment_input_invalid", "Select a billing history collection.");
    const query = { customerId: [customerId], perPage: 20, ...(after ? { after } : {}) };
    const page = collection === "subscriptions" ? client.subscriptions.list(query) : client.transactions.list(query);
    // Fetch one page only; never iterate the SDK collection over the account.
    const data = await page.next();
    if (!Array.isArray(data) || data.length > 20 || typeof page.hasMore !== "boolean" || (page.hasMore && !data.length)) invalid();
    const items = data.map((value) => {
      if (value.customerId !== customerId || typeof value.id !== "string" || typeof value.status !== "string" ||
        typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) invalid();
      const base = { id: value.id, kind: collection === "subscriptions" ? "subscription" : "transaction",
        status: value.status, createdAt: new Date(value.createdAt).toISOString() };
      if (collection === "subscriptions") return base;
      const total = value.details?.totals?.total ?? null;
      if ((total !== null && (typeof total !== "string" || !/^-?[0-9]{1,30}$/.test(total))) || !/^[A-Z]{3}$/.test(value.currencyCode)) invalid();
      // A transaction total is not proof it was paid. Preserve provider status.
      return { ...base, currency: value.currencyCode, totalMinor: total, paidMinor: null };
    });
    return { collection, items, nextCursor: page.hasMore ? items.at(-1).id : null };
  }
  async function readProduct(productId) {
    const value = await client.products.get(productId);
    return { id: value.id, name: value.name };
  }
  async function createProduct({ name }) {
    if (!taxCategory) throw new PaymentError("payment_configuration_invalid", "Set the application's Paddle product tax category before publishing.");
    return client.products.create({ name, taxCategory });
  }
  async function renameProduct({ id, name }) {
    return client.products.update(id, { name });
  }
  async function readPrice(priceId) {
    const value = await client.prices.get(priceId);
    if (value.billingCycle?.frequency !== 1) invalid();
    return { id: value.id, productId: value.productId, amount: Number(value.unitPrice.amount), currency: value.unitPrice.currencyCode, interval: value.billingCycle.interval, active: value.status === "active" };
  }
  async function createPrice({ productId, amount, currency, interval }) {
    return client.prices.create({ productId, description: `${currency} ${amount} per ${interval}`, unitPrice: { amount: String(amount), currencyCode: currency }, billingCycle: { interval, frequency: 1 } });
  }
  return Object.freeze({ validatePlan, verifyAccount, verifyEvent, eventIdentity, loadEvent, createCustomer, createCheckout, createPortal, readHistory, readProduct, createProduct, renameProduct, readPrice, createPrice });
}

export { createPaddlePaymentAdapter };
