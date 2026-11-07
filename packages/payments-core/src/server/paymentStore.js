import { isDeadlockError, isDuplicateEntryError } from "@jskit-ai/database-runtime/shared";
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

// First uses of one key at once can collide on its insert before any work runs (on MySQL and MariaDB, first uses of
// neighbouring keys too, through their gap locks): each collision runs the loser again after a short random wait.
const CREATE_RACE_ATTEMPTS = 4;
const CREATE_IF_MISSING = Object.freeze({ keys: ["id"], action: "ignore" });

/**
 * Runs work once on the row with `attributes.id`, locked in one transaction with the work, creating the row there when
 * it is missing, so work that fails leaves no row behind. Two first uses of one key can collide on that insert before
 * either work runs (a deadlock on MySQL's and MariaDB's gap locks, a duplicate key elsewhere): the loser runs again,
 * up to four runs in all, and finds the winner's row. Work that has started never runs again.
 * @template T
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} handle
 * @param {object} options The transaction's options: its context, and `retry: false`.
 * @param {{ id: string } & Record<string, unknown>} attributes
 * @param {(row: Record<string, any>, txOptions: object) => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withLockedRow(handle, options, attributes, work) {
  for (let attempt = 1; ; attempt += 1) {
    let started = false;
    try {
      return await handle.withTransaction(options, async (txOptions) => {
        let row = await handle.lock(attributes.id, { ...txOptions, missing: "skip" });
        if (!row) {
          await handle.createMany([attributes], { ...txOptions, onConflict: CREATE_IF_MISSING, returning: "none" });
          row = await handle.lock(attributes.id, txOptions);
        }
        started = true;
        return work(row, txOptions);
      });
    } catch (error) {
      if (started || attempt >= CREATE_RACE_ATTEMPTS || !(isDeadlockError(error) || isDuplicateEntryError(error))) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 * 2 ** attempt));
    }
  }
}

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
    return withLockedRow(accounts, accountWork, { id: key, payload: JSON.stringify(empty()) }, async (account, txOptions) => {
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
    return withLockedRow(catalogues, catalogueWork, { id: key, payload: JSON.stringify(emptyCatalogue()) }, async (catalogue, txOptions) => {
      const state = JSON.parse(catalogue.payload);
      const stored = JSON.stringify(state);
      const result = await work(state);
      const payload = JSON.stringify(state);
      if (payload !== stored) await catalogues.patch(key, { payload }, { ...txOptions, returning: "none" });
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
