import { PaymentError, fingerprint } from "./errors.js";

const empty = () => ({ lots: [], subscriptions: {} });
const emptyCatalogue = () => ({ plans: {}, history: [] });

function merchant(scope) {
  const fields = ["applicationId", "integrationId", "providerAccountId", "environment"];
  for (const field of fields) {
    if (typeof scope?.[field] !== "string" || !scope[field] || scope[field].length > 200) throw new TypeError(`Payment scope requires ${field}.`);
  }
  if (!["sandbox", "live"].includes(scope.environment)) throw new TypeError("Payment scope requires sandbox or live.");
  return fields.map((field) => scope[field]);
}
function identifier(value) {
  if (typeof value !== "string" || !value || value.length > 200) throw new TypeError("Payment identity is required (maximum 200 characters).");
  return value;
}
const accountKey = (scope) => fingerprint([...merchant(scope), identifier(scope.subjectId)]);
const customerKey = (scope, customerId) => fingerprint([...merchant(scope), identifier(customerId)]);
const entryKey = (account, reference) => fingerprint([account, identifier(reference)]);
const topUpKey = (scope, topUpId) => fingerprint([...merchant(scope), "top-up", identifier(topUpId)]);

/**
 * The payment store on its table resources' handles: each account, catalogue and top-up is one locked row holding its
 * state as JSON, an account's entries are recorded once per reference, and a provider customer is bound to one
 * subject per merchant. Every call works in a system context, because a row's scope is its key.
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources The handles of PAYMENT_TABLES.
 * @param {(reason: string) => object} dependencies.systemContext
 * @returns {import("./types.js").PaymentStore}
 */
function createPaymentStore({ resources, systemContext }) {
  const { paymentAccounts: accounts, paymentEntries: entries, paymentCustomers: customers, paymentCatalogues: catalogues, paymentTopUps: topUps } = resources;
  const accountOptions = Object.freeze({ context: systemContext("an account is read and changed by its merchant and subject key") });
  const customerOptions = Object.freeze({ context: systemContext("a provider customer is bound and resolved by its merchant and customer key") });
  const catalogueOptions = Object.freeze({ context: systemContext("a catalogue is read and changed by its merchant key") });
  const topUpOptions = Object.freeze({ context: systemContext("a top-up is read and changed by its merchant and top-up key") });

  async function inspect(scope) {
    const account = await accounts.get(accountKey(scope), {}, { ...accountOptions, missing: "skip" });
    return account ? JSON.parse(account.payload) : empty();
  }

  async function withAccount(scope, work) {
    const key = accountKey(scope);
    // The retained account row serializes grants, usage, refunds and event handling.
    return accounts.lockOrCreate({ id: key, payload: JSON.stringify(empty()) }, accountOptions, async (account, txOptions) => {
      const state = JSON.parse(account.payload);
      const stored = JSON.stringify(state);
      const result = await work({
        state,
        async find(reference) {
          const entry = await entries.get(entryKey(key, reference), {}, { ...txOptions, missing: "skip" });
          return entry ? JSON.parse(entry.payload) : null;
        },
        async record(reference, payload) {
          await entries.create({ id: entryKey(key, reference), accountKey: key, payload: JSON.stringify(payload) }, { ...txOptions, returning: "none" });
        }
      });
      // Work that leaves the state as it was, such as a duplicate grant, writes nothing.
      const payload = JSON.stringify(state);
      if (payload !== stored) await accounts.patch(key, { payload }, { ...txOptions, returning: "none" });
      return result;
    });
  }

  async function bindCustomer(scope, customerId, subjectId) {
    const id = customerKey(scope, customerId);
    identifier(subjectId);
    const bound = await customers.findOrCreate({ id, subjectId }, customerOptions);
    if (bound.subjectId !== subjectId) throw new PaymentError("payment_customer_conflict", "This provider customer is already bound to a different billable subject.", 409);
  }

  async function resolveCustomer(scope, customerId) {
    const bound = await customers.get(customerKey(scope, customerId), {}, { ...customerOptions, missing: "skip" });
    return bound?.subjectId ?? null;
  }

  async function inspectCatalogue(scope) {
    const catalogue = await catalogues.get(fingerprint(merchant(scope)), {}, { ...catalogueOptions, missing: "skip" });
    return catalogue ? JSON.parse(catalogue.payload) : emptyCatalogue();
  }

  async function withCatalogue(scope, work) {
    const key = fingerprint(merchant(scope));
    return catalogues.lockOrCreate({ id: key, payload: JSON.stringify(emptyCatalogue()) }, catalogueOptions, async (catalogue, txOptions) => {
      const state = JSON.parse(catalogue.payload);
      const stored = JSON.stringify(state);
      const result = await work(state);
      const payload = JSON.stringify(state);
      if (payload !== stored) await catalogues.patch(key, { payload }, { ...txOptions, returning: "none" });
      return result;
    });
  }

  async function inspectTopUp(scope, topUpId) {
    const topUp = await topUps.get(topUpKey(scope, topUpId), {}, { ...topUpOptions, missing: "skip" });
    return topUp ? JSON.parse(topUp.payload) : null;
  }

  // Writes the top-up down unless one with its id is already there, and answers the one that is: a repeated request
  // gets the first one's state.
  async function createTopUp(scope, topUp) {
    const saved = await topUps.findOrCreate({ id: topUpKey(scope, topUp?.id), payload: JSON.stringify(topUp) }, topUpOptions);
    return JSON.parse(saved.payload);
  }

  // Runs work on the top-up locked, or on null when there is none (the lock creates nothing), and saves the state the
  // work leaves. work also gets the options of the transaction the lock holds, for an application write that must
  // commit with it or not at all: its handle calls take them and join that transaction.
  async function withTopUp(scope, topUpId, work) {
    const key = topUpKey(scope, topUpId);
    return topUps.withTransaction(topUpOptions, async (txOptions) => {
      const locked = await topUps.lock(key, { ...txOptions, missing: "skip" });
      const topUp = locked ? JSON.parse(locked.payload) : null;
      const result = await work({ topUp, options: txOptions });
      const payload = topUp ? JSON.stringify(topUp) : null;
      if (payload && payload !== locked.payload) await topUps.patch(key, { payload }, { ...txOptions, returning: "none" });
      return result;
    });
  }

  return Object.freeze({
    inspect,
    withAccount,
    bindCustomer,
    resolveCustomer,
    inspectCatalogue,
    withCatalogue,
    inspectTopUp,
    createTopUp,
    withTopUp
  });
}

export { createPaymentStore };
