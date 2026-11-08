import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import migration from "../migrations/payments_core_initial.cjs";
import { createPaymentService } from "../src/server/service.js";
import { validatePaymentConfiguration } from "../src/shared/configuration.js";
import { checkForeignKeys } from "@jskit-ai/resource-runtime/server";
import { PAYMENT_TABLES } from "../src/server/paymentResources.js";
import { createTestPaymentStore } from "./support/paymentStore.js";

// The payment store's behaviour on MariaDB, through its public functions, as PaymentStoreFeature provides it: what an
// account, its entries, a provider customer and a merchant's catalogue answer and keep; which scope sees which rows;
// that work on one account or catalogue runs one at a time and rolls back as a whole, its row's creation included; and
// the errors it gives.

// The runtime's own MySQL connection settings (database-runtime's resolveKnexConnectionFromEnvironment).
const RUNTIME_MYSQL = Object.freeze({ supportBigNumbers: true, bigNumberStrings: true, dateStrings: ["DATE"], timezone: "Z" });

/** A migrated database of the test's own, beside TEST_DB_NAME, dropped after the test. */
async function ownDatabase(context, suffix) {
  const name = `${requireTestDatabase(process.env)}_${suffix}`;
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD };
  const admin = knexLib({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
  await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
  await admin.raw("CREATE DATABASE ??", [name]);
  const knex = knexLib({ client: "mysql2", connection: { ...server, database: name, ...RUNTIME_MYSQL }, pool: { min: 0, max: 6 } });
  context.after(async () => {
    await knex.destroy();
    await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
    await admin.destroy();
  });
  await migration.up(knex);
  return knex;
}

const merchant = Object.freeze({ applicationId: "app", integrationId: "billing", providerAccountId: "acct_test", environment: "sandbox" });
const subject = (subjectId, changes = {}) => ({ ...merchant, ...changes, subjectId });
const EMPTY_ACCOUNT = Object.freeze({ lots: [], subscriptions: {} });
const EMPTY_CATALOGUE = Object.freeze({ plans: {}, history: [] });
const IDENTITY_REQUIRED = { name: "TypeError", message: "Payment identity is required (maximum 200 characters)." };

/** The rows in one of the payment tables (COUNT is a big number, which the runtime reads as a string). */
async function rowCount(knex, table) {
  const [{ rows }] = await knex(table).count({ rows: "*" });
  return Number(rows);
}

/** A promise the test resolves itself, to hold one piece of work while others run. */
function gate() {
  let open;
  const opened = new Promise((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

test("the payment table resources declare exactly the foreign keys the migration creates", async (context) => {
  requireTestDatabase(process.env);
  const knex = await ownDatabase(context, "da_payments_keys");
  const resources = PAYMENT_TABLES.map(({ resource }) => resource);
  const tables = resources.map((resource) => resource.tableName);
  assert.deepEqual(await checkForeignKeys({ knex, resources, tables }), { missing: [], undeclared: [] });
});

test("the store refuses incomplete scopes and identities before any work runs", async (context) => {
  requireTestDatabase(process.env);
  const store = await createTestPaymentStore(await ownDatabase(context, "da_pay_refusals"));
  assert.ok(Object.isFrozen(store));
  assert.deepEqual(Object.keys(store), ["inspect", "withAccount", "bindCustomer", "resolveCustomer", "inspectCatalogue", "withCatalogue"]);

  for (const [changes, message] of [
    [{ applicationId: "" }, "Payment scope requires applicationId."],
    [{ integrationId: 7 }, "Payment scope requires integrationId."],
    [{ providerAccountId: "a".repeat(201) }, "Payment scope requires providerAccountId."],
    [{ environment: undefined }, "Payment scope requires environment."],
    [{ environment: "production" }, "Payment scope requires sandbox or live."]
  ]) {
    await assert.rejects(store.inspect(subject("tenant-a", changes)), { name: "TypeError", message }, message);
    await assert.rejects(store.inspectCatalogue({ ...merchant, ...changes }), { name: "TypeError", message }, message);
    await assert.rejects(store.resolveCustomer({ ...merchant, ...changes }, "cus_1"), { name: "TypeError", message }, message);
  }
  // A field of exactly 200 characters is accepted.
  assert.deepEqual(await store.inspect(subject("s".repeat(200), { providerAccountId: "p".repeat(200) })), EMPTY_ACCOUNT);

  let worked = false;
  const work = async () => {
    worked = true;
  };
  await assert.rejects(store.inspect(merchant), IDENTITY_REQUIRED, "an account needs its subject");
  await assert.rejects(store.inspect(subject("s".repeat(201))), IDENTITY_REQUIRED);
  await assert.rejects(store.withAccount(merchant, work), IDENTITY_REQUIRED);
  await assert.rejects(store.withAccount(subject("tenant-a", { environment: "test" })), { name: "TypeError", message: "Payment scope requires sandbox or live." });
  await assert.rejects(store.withCatalogue({ ...merchant, applicationId: null }, work), { name: "TypeError", message: "Payment scope requires applicationId." });
  assert.equal(worked, false, "no work runs for a refused scope");
  await assert.rejects(store.bindCustomer(merchant, "", "tenant-a"), IDENTITY_REQUIRED);
  await assert.rejects(store.bindCustomer(merchant, "cus_1", ""), IDENTITY_REQUIRED);
  await assert.rejects(store.bindCustomer(merchant, "cus_1", 42), IDENTITY_REQUIRED);
  await assert.rejects(store.resolveCustomer(merchant, "c".repeat(201)), IDENTITY_REQUIRED);
  assert.equal(await store.resolveCustomer(merchant, "cus_1"), null, "the refused binding left nothing behind");
});

test("an account starts empty, keeps the state its work leaves as JSON, and answers what the work returns", async (context) => {
  requireTestDatabase(process.env);
  const store = await createTestPaymentStore(await ownDatabase(context, "da_pay_account"));
  const scope = subject("tenant-a");

  const fresh = await store.inspect(scope);
  assert.deepEqual(fresh, EMPTY_ACCOUNT);
  fresh.lots.push({ credits: 1 });
  assert.deepEqual(await store.inspect(scope), EMPTY_ACCOUNT, "each inspect answers a new copy");

  const result = await store.withAccount(scope, async (account) => {
    assert.deepEqual(Object.keys(account).sort(), ["find", "record", "state"]);
    assert.deepEqual(account.state, EMPTY_ACCOUNT, "a new account's work starts from the empty state");
    account.state.lots.push({ credits: 5, grantedAt: new Date(Date.UTC(2026, 0, 1)), note: undefined });
    account.state.subscriptions.pro = { status: "active" };
    account.state.extra = { kept: true };
    return { granted: 5 };
  });
  assert.deepEqual(result, { granted: 5 });
  const expected = {
    lots: [{ credits: 5, grantedAt: "2026-01-01T00:00:00.000Z" }],
    subscriptions: { pro: { status: "active" } },
    extra: { kept: true }
  };
  assert.deepEqual(await store.inspect(scope), expected, "the whole state is kept, as JSON: dates become text, undefined goes");

  await store.withAccount(scope, async ({ state }) => {
    assert.deepEqual(state, expected, "the next work starts from the kept state");
  });
  assert.deepEqual(await store.inspect(scope), expected, "work that changes nothing keeps the state");
  assert.equal(await store.withAccount(scope, async () => undefined), undefined);
});

test("entries are recorded once per reference, read back by find, and belong to their own account", async (context) => {
  requireTestDatabase(process.env);
  const store = await createTestPaymentStore(await ownDatabase(context, "da_pay_entries"));
  const scope = subject("tenant-a");

  await store.withAccount(scope, async ({ find, record }) => {
    assert.equal(await find("event:evt_1"), null);
    assert.equal(await record("event:evt_1", { amount: 5, at: new Date(Date.UTC(2026, 1, 2)), skipped: undefined }), undefined);
    assert.deepEqual(await find("event:evt_1"), { amount: 5, at: "2026-02-02T00:00:00.000Z" }, "seen at once inside the same work");
  });
  assert.deepEqual(await store.withAccount(scope, ({ find }) => find("event:evt_1")), { amount: 5, at: "2026-02-02T00:00:00.000Z" });

  // Another subject, or the same subject under another merchant, has entries of its own.
  for (const other of [subject("tenant-b"), subject("tenant-a", { environment: "live" }), subject("tenant-a", { applicationId: "other-app" })]) {
    assert.equal(await store.withAccount(other, ({ find }) => find("event:evt_1")), null);
  }
  await store.withAccount(subject("tenant-b"), ({ record }) => record("event:evt_1", { amount: 9 }));
  assert.deepEqual(await store.withAccount(subject("tenant-b"), ({ find }) => find("event:evt_1")), { amount: 9 });
  assert.deepEqual(await store.withAccount(scope, ({ find }) => find("event:evt_1")), { amount: 5, at: "2026-02-02T00:00:00.000Z" });

  // Recording a reference twice fails the whole work with the driver's own duplicate-key error (no PaymentError),
  // and nothing the work did is kept.
  await assert.rejects(store.withAccount(scope, async ({ state, record }) => {
    state.lots.push({ credits: 1 });
    await record("event:evt_1", { amount: 6 });
  }), (error) => {
    assert.equal(error.code, "ER_DUP_ENTRY");
    assert.notEqual(error.name, "PaymentError");
    return true;
  });
  assert.deepEqual(await store.inspect(scope), EMPTY_ACCOUNT);
  assert.deepEqual(await store.withAccount(scope, ({ find }) => find("event:evt_1")), { amount: 5, at: "2026-02-02T00:00:00.000Z" });

  await assert.rejects(store.withAccount(scope, ({ find }) => find("")), IDENTITY_REQUIRED);
  await assert.rejects(store.withAccount(scope, ({ record }) => record("r".repeat(201), {})), IDENTITY_REQUIRED);
  await assert.rejects(store.withAccount(scope, ({ find }) => find(7)), IDENTITY_REQUIRED);
});

test("work that fails rolls back its state and entries, and its error reaches the caller unchanged", async (context) => {
  requireTestDatabase(process.env);
  const knex = await ownDatabase(context, "da_pay_rollback");
  const store = await createTestPaymentStore(knex);
  const scope = subject("tenant-a");
  await store.withAccount(scope, async ({ state, record }) => {
    state.lots.push({ credits: 1 });
    await record("debit:first", { quantity: 1 });
  });

  const failure = new Error("provider unavailable");
  await assert.rejects(store.withAccount(scope, async ({ state, record }) => {
    state.lots.push({ credits: 2 });
    state.subscriptions.pro = { status: "active" };
    await record("debit:second", { quantity: 2 });
    throw failure;
  }), (error) => error === failure);
  assert.deepEqual(await store.inspect(scope), { lots: [{ credits: 1 }], subscriptions: {} });
  assert.deepEqual(await store.withAccount(scope, async ({ find }) => [await find("debit:first"), await find("debit:second")]), [{ quantity: 1 }, null]);

  // A new account or catalogue whose first work fails leaves no row: its creation rolls back with the work.
  await assert.rejects(store.withAccount(subject("tenant-new"), async ({ state }) => {
    state.lots.push({ credits: 3 });
    throw failure;
  }), (error) => error === failure);
  assert.deepEqual(await store.inspect(subject("tenant-new")), EMPTY_ACCOUNT);
  await assert.rejects(store.withCatalogue(merchant, async (state) => {
    state.history.push("never kept");
    throw failure;
  }), (error) => error === failure);
  assert.equal(await rowCount(knex, "payment_accounts"), 1, "tenant-a's account alone");
  assert.equal(await rowCount(knex, "payment_catalogues"), 0);
});

test("a reference granted again answers duplicate: true, also when two first grants on a new account race", { timeout: 20_000 }, async (context) => {
  requireTestDatabase(process.env);
  const knex = await ownDatabase(context, "da_pay_duplicate");
  const store = await createTestPaymentStore(knex);
  const configuration = validatePaymentConfiguration({
    integrations: { billing: { provider: "stripe", accountMode: "shared", authentication: { method: "api-key", secretRef: "env:STRIPE_KEY" } } },
    extensions: { payments: {
      version: 1,
      environments: { sandbox: { integrationId: "billing", providerAccountId: "acct_test", webhookSecretRef: "env:STRIPE_WEBHOOK_SECRET", returnUrlRef: "env:APP_URL" } },
      plans: { pro: { name: "Pro", amount: 1200, currency: "USD", interval: "month", features: [], renewalCredits: 100 } }
    } }
  });
  const payments = createPaymentService({ store, configuration, clock: () => 1000 });
  const grant = { reference: "welcome", units: 5, expiresAt: null };

  assert.deepEqual(await payments.grantCredits(subject("tenant-a"), grant), { granted: 5, expiresAt: null, duplicate: false });
  assert.deepEqual(await payments.grantCredits(subject("tenant-a"), grant), { granted: 5, expiresAt: null, duplicate: true });
  assert.equal((await payments.inspect(subject("tenant-a"))).balance, 5);

  // Two first grants on accounts that do not exist yet, each pair with one reference: each account is created once,
  // one grant of each pair applies and the other answers the first one's result as a duplicate.
  const tenants = ["tenant-b", "tenant-c", "tenant-d"];
  const outcomes = await Promise.all(tenants.flatMap((tenant) => [payments.grantCredits(subject(tenant), grant), payments.grantCredits(subject(tenant), grant)]));
  for (const [index, tenant] of tenants.entries()) {
    assert.deepEqual(outcomes.slice(index * 2, index * 2 + 2).map((outcome) => outcome.duplicate).sort(), [false, true], tenant);
    assert.equal((await payments.inspect(subject(tenant))).balance, 5, tenant);
  }
  assert.equal(await rowCount(knex, "payment_accounts"), 4);
  assert.equal(await rowCount(knex, "payment_entries"), 4);
});

test("the hot path: inspect is one read, and work on an existing account locks it once and writes only a changed state", async (context) => {
  requireTestDatabase(process.env);
  const knex = await ownDatabase(context, "da_pay_statements");
  const store = await createTestPaymentStore(knex);
  const scope = subject("tenant-a");
  await store.withAccount(scope, async ({ state, record }) => {
    state.lots.push({ credits: 1 });
    await record("grant:first", { credits: 1 });
  });
  const statementsOf = async (operation) => {
    const statements = [];
    const listener = (query) => statements.push(query.sql);
    knex.on("query", listener);
    try {
      await operation();
    } finally {
      knex.off("query", listener);
    }
    return statements.map((sql) => sql.split(" ")[0].toLowerCase());
  };

  assert.deepEqual(await statementsOf(() => store.inspect(scope)), ["select"]);
  assert.deepEqual(await statementsOf(() => store.withAccount(scope, ({ find }) => find("grant:first"))), ["begin;", "select", "select", "commit;"],
    "the account's lock and the entry's read; an unchanged state is not written");
  // A changed state is one UPDATE, which json-rest-api's patch precedes with one read of the row the work holds locked.
  assert.deepEqual(await statementsOf(() => store.withAccount(scope, async ({ state }) => {
    state.lots[0].credits = 2;
  })), ["begin;", "select", "select", "update", "commit;"]);
  assert.deepEqual((await store.inspect(scope)).lots, [{ credits: 2 }]);
});

test("work on one account runs one at a time, while other accounts, the catalogue and plain reads go on", { timeout: 20_000 }, async (context) => {
  requireTestDatabase(process.env);
  const store = await createTestPaymentStore(await ownDatabase(context, "da_pay_serial"));
  const scope = subject("tenant-a");
  const other = subject("tenant-b");
  await store.withAccount(scope, async ({ state }) => {
    state.count = 0;
  });
  await store.withAccount(other, async () => {});

  const entered = [];
  const firstIn = gate();
  const release = gate();
  const first = store.withAccount(scope, async ({ state }) => {
    entered.push("first");
    firstIn.open();
    const seen = state.count;
    await release.opened;
    state.count = seen + 1;
    return seen;
  });
  await firstIn.opened;
  const second = store.withAccount(scope, async ({ state }) => {
    entered.push("second");
    const seen = state.count;
    state.count = seen + 1;
    return seen;
  });
  // While the first work holds tenant-a: another account's work, the merchant's catalogue and plain reads finish.
  await store.withAccount(other, async ({ state }) => {
    state.touched = true;
  });
  await store.withCatalogue(merchant, async (state) => {
    state.history.push("touched");
  });
  assert.deepEqual(await store.inspect(scope), { lots: [], subscriptions: {}, count: 0 }, "inspect reads what is committed, without waiting");
  assert.deepEqual(entered, ["first"], "the second work on tenant-a waits for the first");
  release.open();
  assert.deepEqual(await Promise.all([first, second]), [0, 1], "the second work saw the first one's state: no update is lost");
  assert.deepEqual(entered, ["first", "second"]);
  assert.equal((await store.inspect(scope)).count, 2);
  assert.equal((await store.inspect(other)).touched, true);
});

test("a provider customer binds to one subject per merchant: the first binding wins and a different one is refused", { timeout: 20_000 }, async (context) => {
  requireTestDatabase(process.env);
  const store = await createTestPaymentStore(await ownDatabase(context, "da_pay_customers"));

  assert.equal(await store.resolveCustomer(merchant, "cus_1"), null);
  assert.equal(await store.bindCustomer(merchant, "cus_1", "tenant-a"), undefined);
  assert.equal(await store.resolveCustomer(merchant, "cus_1"), "tenant-a");
  assert.equal(await store.bindCustomer(merchant, "cus_1", "tenant-a"), undefined, "binding again to the same subject is fine");

  await assert.rejects(store.bindCustomer(merchant, "cus_1", "tenant-b"), (error) => {
    assert.equal(error.name, "PaymentError");
    assert.equal(error.code, "payment_customer_conflict");
    assert.equal(error.statusCode, 409);
    assert.equal(error.message, "This provider customer is already bound to a different billable subject.");
    assert.equal(Object.hasOwn(error, "messageCode"), false);
    return true;
  });
  assert.equal(await store.resolveCustomer(merchant, "cus_1"), "tenant-a");

  // The customer belongs to the merchant: a subject in the scope is ignored, and another merchant has its own.
  assert.equal(await store.resolveCustomer(subject("tenant-z"), "cus_1"), "tenant-a");
  await assert.rejects(store.bindCustomer(subject("tenant-a"), "cus_1", "tenant-b"), { code: "payment_customer_conflict" });
  for (const changes of [{ providerAccountId: "acct_other" }, { environment: "live" }, { integrationId: "other" }, { applicationId: "other-app" }]) {
    assert.equal(await store.resolveCustomer({ ...merchant, ...changes }, "cus_1"), null);
  }
  await store.bindCustomer({ ...merchant, environment: "live" }, "cus_1", "tenant-b");
  assert.equal(await store.resolveCustomer({ ...merchant, environment: "live" }, "cus_1"), "tenant-b");
  assert.equal(await store.resolveCustomer(merchant, "cus_1"), "tenant-a");

  // Two subjects binding a new customer at once: exactly one wins, the other is refused.
  const outcomes = await Promise.allSettled([
    store.bindCustomer(merchant, "cus_2", "tenant-x"),
    store.bindCustomer(merchant, "cus_2", "tenant-y")
  ]);
  const won = outcomes.findIndex((outcome) => outcome.status === "fulfilled");
  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(outcomes[1 - won].reason.code, "payment_customer_conflict");
  assert.equal(await store.resolveCustomer(merchant, "cus_2"), ["tenant-x", "tenant-y"][won]);
});

test("a merchant's catalogue starts empty, keeps what its work leaves, rolls back on failure and is shared by the merchant's subjects", { timeout: 20_000 }, async (context) => {
  requireTestDatabase(process.env);
  const store = await createTestPaymentStore(await ownDatabase(context, "da_pay_catalogue"));

  const fresh = await store.inspectCatalogue(merchant);
  assert.deepEqual(fresh, EMPTY_CATALOGUE);
  fresh.history.push("changed");
  assert.deepEqual(await store.inspectCatalogue(merchant), EMPTY_CATALOGUE, "each inspect answers a new copy");

  const result = await store.withCatalogue(merchant, async (...args) => {
    assert.equal(args.length, 1, "catalogue work gets the state alone");
    const [state] = args;
    assert.deepEqual(state, EMPTY_CATALOGUE);
    state.plans.pro = { productId: "prod_1", priceId: "price_1", publishedAt: new Date(Date.UTC(2026, 2, 3)) };
    state.history.push({ action: "create-price" });
    return "published";
  });
  assert.equal(result, "published");
  const saved = { plans: { pro: { productId: "prod_1", priceId: "price_1", publishedAt: "2026-03-03T00:00:00.000Z" } }, history: [{ action: "create-price" }] };
  assert.deepEqual(await store.inspectCatalogue(merchant), saved);
  assert.deepEqual(await store.inspectCatalogue(subject("tenant-a")), saved, "a subject in the scope is ignored");
  assert.deepEqual(await store.inspect(subject("tenant-a")), EMPTY_ACCOUNT, "the catalogue is apart from the accounts");
  for (const changes of [{ environment: "live" }, { providerAccountId: "acct_other" }, { integrationId: "other" }, { applicationId: "other-app" }]) {
    assert.deepEqual(await store.inspectCatalogue({ ...merchant, ...changes }), EMPTY_CATALOGUE);
  }

  const failure = new Error("review expired");
  await assert.rejects(store.withCatalogue(merchant, async (state) => {
    state.plans.pro.priceId = "price_2";
    throw failure;
  }), (error) => error === failure);
  assert.deepEqual(await store.inspectCatalogue(merchant), saved, "failed work keeps nothing");

  // Catalogue work runs one at a time per merchant.
  const firstIn = gate();
  const release = gate();
  const first = store.withCatalogue(merchant, async (state) => {
    firstIn.open();
    const seen = state.history.length;
    await release.opened;
    state.history.push({ action: "first" });
    return seen;
  });
  await firstIn.opened;
  const second = store.withCatalogue(merchant, async (state) => {
    state.history.push({ action: "second" });
    return state.history.length - 1;
  });
  assert.deepEqual(await store.withCatalogue({ ...merchant, environment: "live" }, async () => "other merchant"), "other merchant");
  release.open();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual((await store.inspectCatalogue(merchant)).history, [{ action: "create-price" }, { action: "first" }, { action: "second" }]);
});
