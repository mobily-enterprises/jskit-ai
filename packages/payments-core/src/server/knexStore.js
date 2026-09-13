import { createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const empty = () => ({ lots: [], subscriptions: {} });

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
const accountKey = (scope) => hash([...merchant(scope), identifier(scope.subjectId)]);

function createKnexPaymentStore({ knex }) {
  if (typeof knex !== "function" || typeof knex.transaction !== "function") throw new TypeError("Supply the application's transactional Knex client.");

  async function inspect(scope) {
    const row = await knex("payment_accounts").where({ account_key: accountKey(scope) }).first();
    return row ? JSON.parse(row.payload) : empty();
  }
  async function withAccount(scope, work) {
    const key = accountKey(scope);
    return knex.transaction(async (trx) => {
      // The retained account row serializes grants, usage, refunds and event handling.
      await trx("payment_accounts").insert({ account_key: key, payload: JSON.stringify(empty()) })
        .onConflict("account_key").merge({ account_key: key });
      const row = await trx("payment_accounts").where({ account_key: key }).forUpdate().first();
      const state = JSON.parse(row.payload);
      const result = await work({
        state,
        async find(reference) {
          const entry = await trx("payment_entries").where({ entry_key: hash([key, identifier(reference)]) }).first();
          return entry ? JSON.parse(entry.payload) : null;
        },
        async record(reference, payload) {
          await trx("payment_entries").insert({ entry_key: hash([key, identifier(reference)]), account_key: key, payload: JSON.stringify(payload) });
        }
      });
      await trx("payment_accounts").where({ account_key: key }).update({ payload: JSON.stringify(state) });
      return result;
    });
  }
  async function bindCustomer(scope, customerId, subjectId) {
    const key = hash([...merchant(scope), identifier(customerId)]);
    identifier(subjectId);
    await knex.transaction(async (trx) => {
      await trx("payment_customers").insert({ customer_key: key, subject_id: subjectId })
        .onConflict("customer_key").merge({ customer_key: key });
      const row = await trx("payment_customers").where({ customer_key: key }).first();
      if (row.subject_id !== subjectId) throw new Error("This provider customer is already bound to a different billable subject.");
    });
  }
  async function resolveCustomer(scope, customerId) {
    const row = await knex("payment_customers").where({ customer_key: hash([...merchant(scope), identifier(customerId)]) }).first();
    return row?.subject_id ?? null;
  }
  async function inspectCatalogue(scope) {
    const row = await knex("payment_catalogues").where({ catalogue_key: hash(merchant(scope)) }).first();
    return row ? JSON.parse(row.payload) : { plans: {}, history: [] };
  }
  async function withCatalogue(scope, work) {
    const key = hash(merchant(scope));
    return knex.transaction(async (trx) => {
      await trx("payment_catalogues").insert({ catalogue_key: key, payload: JSON.stringify({ plans: {}, history: [] }) })
        .onConflict("catalogue_key").merge({ catalogue_key: key });
      const row = await trx("payment_catalogues").where({ catalogue_key: key }).forUpdate().first();
      const state = JSON.parse(row.payload);
      const result = await work(state);
      await trx("payment_catalogues").where({ catalogue_key: key }).update({ payload: JSON.stringify(state) });
      return result;
    });
  }
  return Object.freeze({ inspect, withAccount, bindCustomer, resolveCustomer, inspectCatalogue, withCatalogue });
}

export { createKnexPaymentStore };
