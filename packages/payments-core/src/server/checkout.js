import { createHash, randomUUID } from "node:crypto";
import { PaymentError } from "./service.js";

// Application composition boundary: authorization is mandatory and supplied by
// the app's framework. Actor and subject must come from its authenticated route.
function createPaymentCheckoutService({ adapter, store, payments, merchantScope, returnUrl, authorize }) {
  if (typeof authorize !== "function") throw new TypeError("Supply the application's billable-subject authorization function.");
  const target = new URL(returnUrl);
  if ((target.protocol !== "https:" && !(target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))) || target.username || target.password || target.hash) {
    throw new TypeError("Configure an HTTPS application return/checkout URL (HTTP is allowed only for local development).");
  }
  const merchant = structuredClone(merchantScope);
  async function allowed(actor, subjectId, action) {
    if (typeof subjectId !== "string" || !subjectId || subjectId.length > 200 || await authorize(actor, { subjectId, action }) !== true) {
      throw new PaymentError("payment_forbidden", "You cannot manage this billable account.", 403);
    }
    return { ...merchant, subjectId };
  }
  async function perform(scope, operation, remote, complete) {
    const token = randomUUID();
    const prepared = await store.withAccount(scope, async (tx) => {
      if (tx.state.pendingPaymentOperation) throw new PaymentError("payment_operation_uncertain", "Inspect the unfinished provider request before retrying.", 409);
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
    catch { throw new PaymentError("payment_operation_uncertain", "Inspect this account's provider activity before retrying; the request may have succeeded.", 409); }
    return store.withAccount(scope, async (tx) => {
      if (tx.state.pendingPaymentOperation?.token !== token) throw new PaymentError("payment_operation_conflict", "The pending payment operation changed.", 409);
      const value = await complete(tx, result, prepared);
      delete tx.state.pendingPaymentOperation;
      return value;
    });
  }
  async function checkout({ actor, subjectId, email, planId, requestId }) {
    const scope = await allowed(actor, subjectId, "checkout");
    adapter.validatePlan(planId);
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) throw new PaymentError("payment_request_invalid", "Supply a stable checkout request identifier.");
    if (typeof email !== "string" || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PaymentError("payment_input_invalid", "Supply the authenticated billing contact's email.");
    const identity = createHash("sha256").update(JSON.stringify(scope)).digest("hex");
    const customerId = await perform(scope, async (tx) => tx.state.customerId
      ? { cached: true, result: tx.state.customerId }
      : { action: "customer", email },
    () => adapter.createCustomer({ email, requestId: `customer-${identity}` }),
    async (tx, value) => { tx.state.customerId = value; return value; });
    await store.bindCustomer(merchant, customerId, subjectId);
    return perform(scope, async (tx) => {
      const saved = await tx.find(`checkout:${requestId}`);
      if (saved) {
        if (saved.planId !== planId) throw new PaymentError("payment_reference_conflict", "The checkout request already selected another plan.", 409);
        return { cached: true, result: saved.result };
      }
      if (Object.values(tx.state.subscriptions).some((subscription) =>
        !["canceled", "incomplete_expired"].includes(subscription.status))) {
        throw new PaymentError("payment_subscription_exists", "Manage the existing subscription through billing instead of starting another checkout.", 409);
      }
      return { action: "checkout", customerId, planId, requestId };
    }, () => adapter.createCheckout({ customerId, planId, returnUrl: target.href,
      requestId: `checkout-${createHash("sha256").update(JSON.stringify([scope, requestId])).digest("hex")}` }),
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
      throw new PaymentError("payment_input_invalid", "Select billing subscriptions or transactions and a valid page cursor.");
    }
    // Never accept a customer identifier from the browser or editor caller.
    const { customerId } = await store.inspect(scope);
    if (!customerId) return { collection, items: [], nextCursor: null };
    try { return await adapter.readHistory({ customerId, collection, after }); }
    catch { throw new PaymentError("payment_history_unavailable", "Billing history could not be loaded. Check provider access and retry.", 502); }
  }
  async function portal({ actor, subjectId }) {
    const scope = await allowed(actor, subjectId, "portal");
    return perform(scope, async (tx) => {
      if (!tx.state.customerId) throw new PaymentError("payment_customer_missing", "Create a billing account first.", 404);
      return { action: "portal", customerId: tx.state.customerId };
    }, ({ customerId }) => adapter.createPortal({ customerId, returnUrl: target.href }), async (_tx, result) => result);
  }
  // Reconciliation is an app-server operation. The trusted callback inspects the
  // provider dashboard/API and must return evidence, never browser-supplied data.
  async function reconcilePending({ actor, subjectId, inspectProvider }) {
    const scope = await allowed(actor, subjectId, "reconcile");
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
  async function webhook({ rawBody, signature }) {
    const event = await adapter.verifyEvent(rawBody, signature);
    const identity = adapter.eventIdentity(event);
    if (!identity) return { ignored: true };
    const { eventId, customerId } = identity;
    return payments.reconcileEvent(merchant, { eventId, customerId, load: async () => {
      const facts = await adapter.loadEvent(event);
      if (!facts || facts.customerId !== customerId) throw new PaymentError("payment_provider_result_invalid", "The event is not a supported subscription payment for this customer.", 422);
      return facts;
    } });
  }
  return Object.freeze({ account, history, checkout, portal, webhook, reconcilePending });
}

export { createPaymentCheckoutService };
