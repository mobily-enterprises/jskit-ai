import { createHash } from "node:crypto";

class PaymentError extends Error {
  constructor(code, message, statusCode = 422) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}
const fail = (code, message, status) => { throw new PaymentError(code, message, status); };
function reference(value) {
  if (typeof value !== "string" || !value || value.length > 150 || ["__proto__", "constructor", "prototype"].includes(value)) fail("payment_input_invalid", "Use a nonempty business reference of at most 150 characters.");
  return value;
}
function units(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1e9) fail("payment_input_invalid", "Use a positive integer credit quantity, at most one billion.");
  return value;
}
function timestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail("payment_input_invalid", "Use an integer UTC timestamp in milliseconds.");
  return value;
}
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const unexpired = (lot, now) => lot.expiresAt === null || lot.expiresAt > now;
const available = (lots, now) => lots.reduce((sum, lot) => sum + (unexpired(lot, now) ? lot.remaining : 0), 0);

async function once(tx, key, input, work) {
  const digest = fingerprint(input);
  const previous = await tx.find(key);
  if (previous) {
    if (previous.digest !== digest) fail("payment_reference_conflict", "This business reference was already used with different inputs.", 409);
    return { ...previous.result, duplicate: true };
  }
  const result = await work();
  await tx.record(key, { digest, input, result });
  return { ...result, duplicate: false };
}

async function grant(tx, { reference: id, units: quantity, expiresAt }, now) {
  reference(id); units(quantity);
  if (expiresAt !== null) timestamp(expiresAt);
  return once(tx, `grant:${id}`, [quantity, expiresAt], async () => {
    if (!Number.isSafeInteger(available(tx.state.lots, now) + quantity)) fail("payment_balance_limit", "Credit balance exceeds the supported integer range.");
    tx.state.lots = tx.state.lots.filter((lot) => unexpired(lot, now));
    tx.state.lots.push({ id, remaining: quantity, expiresAt });
    return { granted: quantity, expiresAt };
  });
}

// Server-side domain API. The application authorizes the billable subject before
// invoking it; none of these methods is an HTTP endpoint or a browser authority.
function createPaymentService({ store, configuration, clock = Date.now }) {
  if (!store?.withAccount || !store?.inspect || !configuration?.plans) throw new TypeError("Supply payment storage and validated payment configuration.");
  const plans = structuredClone(configuration.plans);
  const environments = structuredClone(configuration.environments);
  function checkScope(scope) {
    const expected = environments[scope?.environment];
    if (!expected || expected.integrationId !== scope.integrationId || expected.providerAccountId !== scope.providerAccountId) {
      fail("payment_scope_invalid", "The payment scope does not match this environment's merchant configuration.", 403);
    }
  }

  async function inspect(scope) {
    checkScope(scope);
    const state = await store.inspect(scope);
    const now = timestamp(clock());
    const subscriptions = Object.values(state.subscriptions);
    const features = [...new Set(subscriptions.filter((subscription) =>
      subscription.status === "active" && subscription.periodEnd > now && plans[subscription.planId])
      .flatMap((subscription) => plans[subscription.planId].features))];
    return { balance: available(state.lots, now), features, subscriptions };
  }

  async function requireFeature(scope, feature) {
    if (!(await inspect(scope)).features.includes(feature)) fail("payment_feature_required", "Your subscription does not include this feature.", 403);
  }

  async function grantCredits(scope, input) {
    checkScope(scope);
    return store.withAccount(scope, (tx) => grant(tx, input, timestamp(clock())));
  }

  async function debitCredits(scope, { reference: id, units: quantity }) {
    checkScope(scope);
    reference(id); units(quantity);
    return store.withAccount(scope, (tx) => once(tx, `debit:${id}`, [quantity], async () => {
      const now = timestamp(clock());
      if (available(tx.state.lots, now) < quantity) fail("payment_insufficient_credits", "Not enough credits for this action.", 409);
      let remaining = quantity;
      const allocations = [];
      const lots = tx.state.lots.filter((lot) => unexpired(lot, now))
        .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
      for (const lot of lots) {
        const taken = Math.min(remaining, lot.remaining);
        if (!taken) continue;
        lot.remaining -= taken;
        remaining -= taken;
        allocations.push({ grantId: lot.id, units: taken });
        if (!remaining) break;
      }
      return { debited: quantity, allocations };
    }));
  }

  async function refundDebit(scope, { debitReference }) {
    checkScope(scope);
    reference(debitReference);
    return store.withAccount(scope, (tx) => once(tx, `refund:${debitReference}`, [debitReference], async () => {
      const debit = await tx.find(`debit:${debitReference}`);
      if (!debit) fail("payment_debit_missing", "No debit exists for this reference.", 404);
      const now = timestamp(clock());
      let restored = 0;
      for (const allocation of debit.result.allocations) {
        const lot = tx.state.lots.find((item) => item.id === allocation.grantId);
        if (lot && unexpired(lot, now)) {
          lot.remaining += allocation.units;
          restored += allocation.units;
        }
      }
      return { restored, expired: debit.result.debited - restored };
    }));
  }

  // Called only after provider signature/account verification. Resolve customer
  // from a server-created binding; never use a subject ID from webhook metadata.
  // Load fresh provider facts under the account lock, so reordered events cannot
  // overwrite newer state. A failed load rolls back the event receipt and grants.
  async function reconcileEvent(merchantScope, { eventId, customerId, load }) {
    checkScope(merchantScope);
    reference(eventId); reference(customerId);
    if (typeof load !== "function") throw new TypeError("Supply an authenticated provider reconciliation function.");
    const subjectId = await store.resolveCustomer(merchantScope, customerId);
    if (!subjectId) fail("payment_customer_unbound", "Bind this provider customer before processing its events.", 409);
    const scope = { ...merchantScope, subjectId };
    return store.withAccount(scope, (tx) => once(tx, `event:${eventId}`, [customerId], async () => {
      const { subscription, renewal } = await load();
      reference(subscription?.id);
      if (!["active", "trialing", "past_due", "paused", "canceled", "unpaid", "incomplete", "incomplete_expired"].includes(subscription.status) ||
          !Object.hasOwn(plans, subscription.planId)) fail("payment_provider_result_invalid", "Check the provider subscription and logical price binding.", 502);
      timestamp(subscription.periodEnd);
      tx.state.subscriptions[subscription.id] = {
        id: subscription.id, status: subscription.status, planId: subscription.planId, periodEnd: subscription.periodEnd
      };
      let creditGrant = null;
      if (renewal) {
        reference(renewal.id);
        timestamp(renewal.periodEnd);
        if (!Object.hasOwn(plans, renewal.planId)) fail("payment_provider_result_invalid", "Check the renewal's logical price binding.", 502);
        const quantity = plans[renewal.planId].renewalCredits;
        // A provider invoice/transaction is the business key, not its delivery ID.
        if (quantity) creditGrant = await grant(tx, { reference: `renewal:${renewal.id}`, units: quantity, expiresAt: renewal.periodEnd }, timestamp(clock()));
      }
      return { subscriptionId: subscription.id, creditGrant };
    }));
  }

  return Object.freeze({ inspect, requireFeature, grantCredits, debitCredits, refundDebit, reconcileEvent });
}

export { createPaymentService, PaymentError };
