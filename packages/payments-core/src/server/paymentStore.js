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

/**
 * The payment store on its table resources' handles: each account and each catalogue is one locked row holding its
 * state as JSON, an account's entries are recorded once per reference, and a provider customer is bound to one
 * subject per merchant. Every call works in a system context, because a row's scope is its key.
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources The handles of PAYMENT_TABLES.
 * @param {(reason: string) => object} dependencies.systemContext
 * @returns {import("./types.js").PaymentStore}
 */
function createPaymentStore({ resources, systemContext }) {
  const { paymentAccounts: accounts, paymentEntries: entries, paymentCustomers: customers, paymentCatalogues: catalogues } = resources;
  const accountOptions = Object.freeze({ context: systemContext("an account is read and changed by its merchant and subject key") });
  const customerOptions = Object.freeze({ context: systemContext("a provider customer is bound and resolved by its merchant and customer key") });
  const catalogueOptions = Object.freeze({ context: systemContext("a catalogue is read and changed by its merchant key") });
  // One transaction per work, run once, since work may call the payment provider.
  const accountWork = Object.freeze({ ...accountOptions, retry: false });
  const catalogueWork = Object.freeze({ ...catalogueOptions, retry: false });

  async function inspect(scope) {
    const account = await accounts.get(accountKey(scope), {}, { ...accountOptions, missing: "skip" });
    return account ? JSON.parse(account.payload) : empty();
  }

  async function withAccount(scope, work) {
    const key = accountKey(scope);
    // The retained account row serializes grants, usage, refunds and event handling.
    await accounts.findOrCreate({ id: key, payload: JSON.stringify(empty()) }, accountOptions);
    return accounts.withTransaction(accountWork, async (txOptions) => {
      const state = JSON.parse((await accounts.lock(key, txOptions)).payload);
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
      await accounts.patch(key, { payload: JSON.stringify(state) }, { ...txOptions, returning: "none" });
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
    await catalogues.findOrCreate({ id: key, payload: JSON.stringify(emptyCatalogue()) }, catalogueOptions);
    return catalogues.withTransaction(catalogueWork, async (txOptions) => {
      const state = JSON.parse((await catalogues.lock(key, txOptions)).payload);
      const result = await work(state);
      await catalogues.patch(key, { payload: JSON.stringify(state) }, { ...txOptions, returning: "none" });
      return result;
    });
  }

  return Object.freeze({
    inspect,
    withAccount,
    bindCustomer,
    resolveCustomer,
    inspectCatalogue,
    withCatalogue
  });
}

export { createPaymentStore };
