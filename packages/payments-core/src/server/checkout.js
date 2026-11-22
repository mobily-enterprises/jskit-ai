import { randomUUID } from "node:crypto";
import { APP_ENVIRONMENTS } from "@jskit-ai/kernel/shared/support/appEnvironment";
import { PaymentError, fingerprint } from "./errors.js";
import { SETTLED_TOP_UP, checkTopUpAmount, composedTopUps, nextTopUpStatus, topUpReturnUrl, topUpView } from "./topUps.js";

const REQUEST_ID = /^[A-Za-z0-9_-]{1,100}$/;
const TOP_UP_ID = /^[0-9a-f]{64}$/u;

function requestIdentifier(requestId) {
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) throw new PaymentError("payment_request_invalid", "Supply a stable checkout request identifier.");
  return requestId;
}
function billingEmail(email) {
  if (typeof email !== "string" || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PaymentError("payment_input_invalid", "Supply the authenticated billing contact's email.", 422, { messageCode: "payments.input.billingEmail" });
  return email;
}
// A provider failure is shown as one safe sentence; the provider's own error stays the cause, for the application's log.
function providerUnavailable(error) {
  if (error instanceof PaymentError) return error;
  return new PaymentError("payment_provider_unavailable", "The payment provider did not answer. Try again: repeating this request is safe.", 502, { cause: error });
}

/**
 * Application composition boundary: authorization is mandatory and supplied by
 * the app's framework. Actor and subject must come from its authenticated route.
 * @param {object} dependencies
 * @param {import("./types.js").PaymentProviderAdapter} dependencies.adapter
 * @param {import("./types.js").PaymentStore} dependencies.store
 * @param {import("./types.js").PaymentService} dependencies.payments
 * @param {import("./types.js").PaymentMerchantScope} dependencies.merchantScope
 * @param {string} dependencies.returnUrl
 * @param {(actor: unknown, request: { subjectId: string, action: string }) => boolean | Promise<boolean>} dependencies.authorize
 * @param {"development" | "test" | "staging" | "production"} dependencies.appEnv The application's APP_ENV
 *   (`appEnvironment(env)`). Only production takes real money: elsewhere checkout, top-ups and billing changes in the
 *   live payment environment are refused; the sandbox environment works everywhere.
 * @param {import("./types.js").PaymentTopUps} [dependencies.topUps] Prepaid top-ups: the validated configuration's
 *   `topUps` as `offer`, and `credit`, the application's function that adds a paid top-up to its own balance.
 * @param {() => number} [dependencies.clock]
 */
function createPaymentCheckoutService({ adapter, store, payments, merchantScope, returnUrl, authorize, appEnv, topUps, clock = Date.now }) {
  // readable-check: allow method-probe - input validation: the application passes its billable-subject authorization
  if (typeof authorize !== "function") throw new TypeError("Supply the application's billable-subject authorization function.");
  if (!APP_ENVIRONMENTS.includes(appEnv)) throw new TypeError("Supply appEnv, the application's APP_ENV: appEnvironment(env).");
  const target = new URL(returnUrl);
  if ((target.protocol !== "https:" && !(target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))) || target.username || target.password || target.hash) {
    throw new TypeError("Configure an HTTPS application return/checkout URL (HTTP is allowed only for local development).");
  }
  const merchant = structuredClone(merchantScope);
  const prepaid = composedTopUps(topUps, adapter, store);
  // Before any provider write: outside production nothing creates a live customer, checkout or billing session.
  function requireRealMoneyAllowed() {
    if (merchant.environment === "live" && appEnv !== "production") {
      throw new PaymentError("payment_sandbox_only", "Only production takes real payments: use the sandbox payment environment.", 409);
    }
  }
  async function allowed(actor, subjectId, action) {
    if (typeof subjectId !== "string" || !subjectId || subjectId.length > 200 || await authorize(actor, { subjectId, action }) !== true) {
      throw new PaymentError("payment_forbidden", "You cannot manage this billable account.", 403);
    }
    return { ...merchant, subjectId };
  }
  async function perform(scope, operation, remote, complete) {
    const token = randomUUID();
    const prepared = await store.withAccount(scope, async (tx) => {
      if (tx.state.pendingPaymentOperation) throw new PaymentError("payment_operation_uncertain", "Inspect the unfinished provider request before retrying.", 409, { messageCode: "payments.operation.unfinished" });
      const ready = await operation(tx);
      if (ready.cached) return ready;
      tx.state.pendingPaymentOperation = { token, ...ready };
      return ready;
    });
    if (prepared.cached) return prepared.result;
    // Intent commits BEFORE the network request. A killed process leaves an
    // unresolved operation, rather than permitting a duplicate provider write.
    let result;
    try { result = await remote(prepared); }
    catch { throw new PaymentError("payment_operation_uncertain", "Inspect this account's provider activity before retrying; the request may have succeeded.", 409, { messageCode: "payments.operation.mayHaveSucceeded" }); }
    return store.withAccount(scope, async (tx) => {
      if (tx.state.pendingPaymentOperation?.token !== token) throw new PaymentError("payment_operation_conflict", "The pending payment operation changed.", 409);
      const value = await complete(tx, result, prepared);
      delete tx.state.pendingPaymentOperation;
      return value;
    });
  }
  async function checkout({ actor, subjectId, email, planId, requestId }) {
    const scope = await allowed(actor, subjectId, "checkout");
    requireRealMoneyAllowed();
    adapter.validatePlan(planId);
    requestIdentifier(requestId);
    billingEmail(email);
    const identity = fingerprint(scope);
    const customerId = await perform(scope, async (tx) => tx.state.customerId
      ? { cached: true, result: tx.state.customerId }
      : { action: "customer", email },
    () => adapter.createCustomer({ email, requestId: `customer-${identity}` }),
    async (tx, value) => { tx.state.customerId = value; return value; });
    await store.bindCustomer(merchant, customerId, subjectId);
    return perform(scope, async (tx) => {
      const saved = await tx.find(`checkout:${requestId}`);
      if (saved) {
        if (saved.planId !== planId) throw new PaymentError("payment_reference_conflict", "The checkout request already selected another plan.", 409, { messageCode: "payments.reference.otherPlan" });
        return { cached: true, result: saved.result };
      }
      if (Object.values(tx.state.subscriptions).some((subscription) =>
        !["canceled", "incomplete_expired"].includes(subscription.status))) {
        throw new PaymentError("payment_subscription_exists", "Manage the existing subscription through billing instead of starting another checkout.", 409);
      }
      return { action: "checkout", customerId, planId, requestId };
    }, () => adapter.createCheckout({ customerId, planId, returnUrl: target.href,
      requestId: `checkout-${fingerprint([scope, requestId])}` }),
    async (tx, result) => { await tx.record(`checkout:${requestId}`, { planId, result }); return result; });
  }
  async function account({ actor, subjectId }) {
    const scope = await allowed(actor, subjectId, "account");
    const state = await payments.inspect(scope);
    const customer = await store.inspect(scope);
    return { ...state, hasCustomer: Boolean(customer.customerId) };
  }
  async function history({ actor, subjectId, collection, after = null }) {
    const scope = await allowed(actor, subjectId, "history");
    if (!["subscriptions", "transactions"].includes(collection) ||
      (after !== null && (typeof after !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(after)))) {
      throw new PaymentError("payment_input_invalid", "Select billing subscriptions or transactions and a valid page cursor.", 422, { messageCode: "payments.input.historyPage" });
    }
    // Never accept a customer identifier from the browser or editor caller.
    const { customerId } = await store.inspect(scope);
    if (!customerId) return { collection, items: [], nextCursor: null };
    try { return await adapter.readHistory({ customerId, collection, after }); }
    catch { throw new PaymentError("payment_history_unavailable", "Billing history could not be loaded. Check provider access and retry.", 502); }
  }
  async function portal({ actor, subjectId }) {
    const scope = await allowed(actor, subjectId, "portal");
    requireRealMoneyAllowed();
    return perform(scope, async (tx) => {
      if (!tx.state.customerId) throw new PaymentError("payment_customer_missing", "Create a billing account first.", 404);
      return { action: "portal", customerId: tx.state.customerId };
    }, ({ customerId }) => adapter.createPortal({ customerId, returnUrl: target.href }), async (_tx, result) => result);
  }
  // Reconciliation is an app-server operation. The trusted callback inspects the
  // provider dashboard/API and must return evidence, never browser-supplied data.
  async function reconcilePending({ actor, subjectId, inspectProvider }) {
    const scope = await allowed(actor, subjectId, "reconcile");
    // readable-check: allow method-probe - input validation: the caller passes its server-side provider inspection
    if (typeof inspectProvider !== "function") throw new TypeError("Supply the server's provider inspection function.");
    return store.withAccount(scope, async (tx) => {
      const pending = tx.state.pendingPaymentOperation;
      if (!pending) return { pending: false };
      const evidence = await inspectProvider(structuredClone(pending));
      if (evidence?.confirmedNotCreated === true) {
        delete tx.state.pendingPaymentOperation;
        return { pending: false, retryAllowed: true };
      }
      const result = evidence?.result;
      if (pending.action === "customer" && typeof result === "string" && result) tx.state.customerId = result;
      else if (pending.action === "checkout" && typeof result?.id === "string" && typeof result.url === "string") {
        await tx.record(`checkout:${pending.requestId}`, { planId: pending.planId, result });
      } else if (!(pending.action === "portal" && typeof result?.url === "string")) {
        throw new PaymentError("payment_reconciliation_required", "Provider inspection did not resolve this request.", 409);
      }
      delete tx.state.pendingPaymentOperation;
      return { pending: false, result };
    });
  }
  function requireTopUps() {
    if (!prepaid) throw new PaymentError("payment_top_ups_unavailable", "This application takes no top-ups.", 409);
    return prepaid;
  }
  // Starts a top-up: writes it down for the authorized subject, then opens a one-off Checkout payment for it. The
  // same request id answers the same top-up and Checkout page; a failed provider request leaves it starting, and
  // repeating the request asks the provider again under the same idempotency key.
  async function topUp({ actor, subjectId, amount, requestId, email = null, description = null }) {
    await allowed(actor, subjectId, "topUp");
    const { offer } = requireTopUps();
    requireRealMoneyAllowed();
    requestIdentifier(requestId);
    checkTopUpAmount(offer, amount);
    if (email !== null) billingEmail(email);
    if (description !== null && (typeof description !== "string" || !description || description.length > 500)) {
      throw new PaymentError("payment_input_invalid", "Describe the top-up in at most 500 characters, or leave the description out.", 422, { messageCode: "payments.input.topUpDescription" });
    }
    const id = fingerprint([merchant.applicationId, merchant.integrationId, merchant.providerAccountId, merchant.environment, subjectId, requestId]);
    const saved = await store.createTopUp(merchant, {
      id, subjectId, requestId, amount, currency: offer.currency, status: "starting", sessionId: null, url: null, paymentIntentId: null, createdAt: clock(), settledAt: null
    });
    if (saved.amount !== amount || saved.currency !== offer.currency) {
      throw new PaymentError("payment_reference_conflict", "The top-up request already chose another amount.", 409, { messageCode: "payments.reference.otherAmount" });
    }
    if (saved.status !== "starting") return topUpView(saved);
    let page;
    try {
      page = await adapter.createTopUpCheckout({
        topUpId: id, amount, currency: offer.currency, name: offer.name, description, email,
        returnUrl: topUpReturnUrl(target.href, id), requestId: `top-up-${id}`
      });
    } catch (error) { throw providerUnavailable(error); }
    return store.withTopUp(merchant, id, async (held) => {
      if (held.topUp.status === "starting") Object.assign(held.topUp, { status: "open", sessionId: page.id, url: page.url });
      return topUpView(held.topUp);
    });
  }
  // The one path that settles a top-up, for its webhook and its return page alike. Under the top-up's row lock the
  // provider's outcome moves its status on (nextTopUpStatus), and only the move to paid calls the application's
  // credit, in the same transaction: a second report of the same payment, from either door, finds it paid and
  // credits nothing, and a credit that fails rolls the move back, so the next report credits it. null: the facts
  // are about no top-up of this merchant, or a Checkout session other than the one written down for it.
  async function settle(facts) {
    const { credit } = requireTopUps();
    return store.withTopUp(merchant, facts.topUpId, async (held) => {
      const saved = held.topUp;
      if (!saved || (saved.sessionId ?? facts.sessionId) !== facts.sessionId) return null;
      // A top-up still starting lost the provider's answer after its session was made: the session it names is its own.
      saved.sessionId = facts.sessionId;
      const status = nextTopUpStatus(saved.status === "starting" ? "open" : saved.status, facts.outcome);
      const credited = status === "paid" && saved.status !== "paid";
      if (credited) {
        if (facts.amount !== saved.amount || facts.currency !== saved.currency) {
          throw new PaymentError("payment_provider_result_invalid", "The amount paid differs from the top-up's amount, so it was not credited.", 502, { messageCode: "payments.provider.topUpAmount" });
        }
        await credit({ reference: `top-up:${saved.id}`, subjectId: saved.subjectId, amount: saved.amount, currency: saved.currency }, held.options);
        saved.paymentIntentId = facts.paymentIntentId;
      }
      if (status !== saved.status) Object.assign(saved, { status, settledAt: SETTLED_TOP_UP.includes(status) ? clock() : null });
      return { ...topUpView(saved), credited };
    });
  }
  // The application's return page asks: the server reads the top-up's Checkout session from the provider with its
  // own key and settles it, so nothing the browser says counts as payment. A settled top-up answers without asking.
  async function confirmTopUp({ actor, subjectId, topUpId }) {
    await allowed(actor, subjectId, "topUp");
    requireTopUps();
    const saved = typeof topUpId === "string" && TOP_UP_ID.test(topUpId) ? await store.inspectTopUp(merchant, topUpId) : null;
    if (saved?.subjectId !== subjectId) throw new PaymentError("payment_top_up_missing", "This account has no such top-up.", 404);
    if (SETTLED_TOP_UP.includes(saved.status) || !saved.sessionId) return { ...topUpView(saved), credited: false };
    let facts;
    try { facts = await adapter.retrieveTopUpCheckout(saved.sessionId); }
    catch (error) { throw providerUnavailable(error); }
    if (facts.topUpId !== saved.id) throw new PaymentError("payment_provider_result_invalid", "Check the Stripe account and the top-up's Checkout session.", 502, { messageCode: "payments.provider.topUpSession" });
    return settle(facts);
  }
  async function webhook({ rawBody, signature }) {
    const event = await adapter.verifyEvent(rawBody, signature);
    if (prepaid) {
      // A Checkout session naming no top-up of this merchant, another system's on the same account say, is acknowledged and left.
      const facts = adapter.topUpEvent(event);
      if (facts) return (TOP_UP_ID.test(facts.topUpId) && await settle(facts)) || { ignored: true };
    }
    const identity = adapter.eventIdentity(event);
    if (!identity) return { ignored: true };
    const { eventId, customerId } = identity;
    return payments.reconcileEvent(merchant, { eventId, customerId, load: async () => {
      const facts = await adapter.loadEvent(event);
      if (!facts || facts.customerId !== customerId) throw new PaymentError("payment_provider_result_invalid", "The event is not a supported subscription payment for this customer.", 422, { messageCode: "payments.provider.unsupportedEvent" });
      return facts;
    } });
  }
  return Object.freeze({
    account,
    history,
    checkout,
    portal,
    topUp,
    confirmTopUp,
    webhook,
    reconcilePending
  });
}

export { createPaymentCheckoutService };
