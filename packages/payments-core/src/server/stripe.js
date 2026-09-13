import Stripe from "stripe";
import { PaymentError } from "./service.js";

const id = (value) => typeof value === "string" ? value : value?.id;
const invalid = () => { throw new PaymentError("payment_provider_result_invalid", "Check the Stripe account, price mapping and subscription shape.", 502); };

function createStripePaymentAdapter({ apiKey, webhookSecret, environment, providerAccountId, priceBindings, historicalPriceBindings = {}, client = new Stripe(apiKey, { maxNetworkRetries: 0 }) }) {
  if (!["sandbox", "live"].includes(environment) || typeof webhookSecret !== "string" || !webhookSecret || !providerAccountId) throw new TypeError("Supply Stripe credentials, environment and account identity.");
  const live = environment === "live";
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
    const account = await client.accounts.retrieve();
    const balance = await client.balance.retrieve();
    if (account.id !== providerAccountId || balance.livemode !== live) invalid();
    return { accountId: account.id, environment, chargesEnabled: account.charges_enabled === true, payoutsEnabled: account.payouts_enabled === true };
  }
  async function verifyEvent(rawBody, signature) {
    if (!Buffer.isBuffer(rawBody)) throw new PaymentError("payment_signature_invalid", "Supply the unmodified webhook request bytes.", 400);
    let event;
    try { event = client.webhooks.constructEvent(rawBody, signature, webhookSecret); }
    catch { throw new PaymentError("payment_signature_invalid", "Stripe webhook verification failed.", 400); }
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
    if (!Object.hasOwn(prices, planId)) throw new PaymentError("payment_plan_unknown", "Select a published payment plan.");
    await verifyAccount();
    const result = await client.checkout.sessions.create({ mode: "subscription", customer: customerId,
      line_items: [{ price: prices[planId], quantity: 1 }], success_url: returnUrl, cancel_url: returnUrl
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
    if (!["subscriptions", "transactions"].includes(collection)) throw new PaymentError("payment_input_invalid", "Select a billing history collection.");
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
  async function createPrice({ productId, amount, currency, interval, requestId }) {
    await verifyAccount();
    return client.prices.create({ product: productId, unit_amount: amount, currency: currency.toLowerCase(), recurring: { interval } }, { idempotencyKey: requestId });
  }
  return Object.freeze({ validatePlan, verifyAccount, verifyEvent, eventIdentity, loadEvent, createCustomer, createCheckout, createPortal, readHistory, readProduct, createProduct, renameProduct, readPrice, createPrice });
}

export { createStripePaymentAdapter };
