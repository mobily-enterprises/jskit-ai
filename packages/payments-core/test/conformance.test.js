import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv';
import knex from 'knex';
import migration from '../migrations/payments_core_initial.cjs';
import { validatePaymentConfiguration } from '../src/shared/configuration.js';
import { createPaymentService } from '../src/server/service.js';
import { createPaymentCheckoutService } from '../src/server/checkout.js';
import { createTestPaymentStore } from './support/paymentStore.js';
import { migratePayments } from './support/migrations.js';

const fixture = JSON.parse(await readFile(new URL('../contracts/conformance.json', import.meta.url), 'utf8'));
const schema = JSON.parse(await readFile(new URL('../contracts/configuration.schema.json', import.meta.url), 'utf8'));

test('portable configuration fixtures distinguish JSON Schema from cross-reference validation', () => {
  const validate = new Ajv({ strict: true }).compile(schema);
  for (const item of fixture.configurationCases) {
    assert.equal(validate(item.document.extensions.payments), item.schemaValid, item.id);
    if (item.configurationValid) assert.deepEqual(validatePaymentConfiguration(item.document), item.document.extensions.payments, item.id);
    else assert.throws(() => validatePaymentConfiguration(item.document), { code: 'payment_configuration_invalid' }, item.id);
  }
});

test('payment binding errors identify the field to repair without returning credentials', () => {
  const cases = [
    ['missing-connection', 'integrationId', /shared Stripe or Paddle/],
    ['inline-api-key', 'integrationId', /Env reference/],
    ['paddle-environment-mismatch', 'integrationId', /configured for sandbox/],
    ['paddle-client-token-missing', 'publicClientTokenRef', /public client token/],
    ['paddle-top-ups', 'integrationId', /Top-ups take Stripe Checkout payments/]
  ];
  for (const [id, field, message] of cases) {
    const item = fixture.configurationCases.find((entry) => entry.id === id);
    assert.throws(() => validatePaymentConfiguration(item.document), (error) => {
      assert.equal(error.code, 'payment_configuration_invalid');
      assert.equal(error.statusCode, 422);
      assert.ok(error.fieldErrors.some((entry) => entry.path === `extensions.payments/environments/sandbox/${field}` && message.test(entry.message)), id);
      assert.doesNotMatch(JSON.stringify(error.fieldErrors), /not-an-env-reference/);
      return true;
    });
  }
  const inverted = fixture.configurationCases.find((entry) => entry.id === 'top-up-range-inverted').document;
  assert.throws(() => validatePaymentConfiguration(inverted), (error) => {
    assert.deepEqual(error.fieldErrors.map((entry) => entry.path), ['extensions.payments/topUps/maximumAmount']);
    return true;
  });
  const document = structuredClone(fixture.configurationCases.find((entry) => entry.id === 'paddle-sandbox').document);
  delete document.extensions.payments.environments.sandbox.taxCategory;
  delete document.extensions.payments.environments.sandbox.publicClientTokenRef;
  assert.throws(() => validatePaymentConfiguration(document), (error) => {
    assert.deepEqual(error.fieldErrors.map((entry) => entry.path), [
      'extensions.payments/environments/sandbox/taxCategory',
      'extensions.payments/environments/sandbox/publicClientTokenRef'
    ]);
    return true;
  });
});

test('portable account sequence defines actual credit, renewal, expiry and subject-isolation outcomes', async () => {
  const scenario = fixture.accountScenario;
  const db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
  await migration.up(db);
  const store = await createTestPaymentStore(db);
  let now = scenario.clock;
  const service = createPaymentService({ store, configuration: validatePaymentConfiguration(scenario.document), clock: () => now });
  const { subjectId, ...merchant } = scenario.scope;
  // Expected objects assert the listed fields recursively; arrays are exact.
  const compare = (actual, expected) => {
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return assert.deepEqual(actual, expected);
    for (const [key, value] of Object.entries(expected)) compare(actual[key], value);
  };
  try {
    await store.bindCustomer(merchant, scenario.customerId, subjectId);
    for (const step of scenario.steps) {
      if (step.clock !== undefined) now = step.clock;
      const scope = { ...scenario.scope, subjectId: step.subjectId ?? subjectId };
      const run = () => step.operation === 'reconcileEvent'
        ? service.reconcileEvent(merchant, { ...step.input, load: async () => structuredClone(step.facts) })
        : service[step.operation](scope, step.input);
      if (step.error) await assert.rejects(run(), { code: step.error });
      else compare(await run(), step.expect);
    }
  } finally { await migration.down(db); await db.destroy(); }
});

test('portable top-up sequence defines when a top-up is credited, whichever door reports its payment', async () => {
  const scenario = fixture.topUpScenario;
  const db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
  await migratePayments(db);
  await db.schema.createTable('conformance_credits', (table) => {
    table.increments('id');
    table.string('subject_id').notNullable();
    table.integer('amount').notNullable();
    table.string('currency').notNullable();
  });
  const store = await createTestPaymentStore(db);
  const configuration = validatePaymentConfiguration(scenario.document);
  const { subjectId, ...merchantScope } = scenario.scope;
  // The controlled provider: each top-up's Checkout session, and the facts the step's door reports for it.
  const sessions = new Map();
  let reported = null;
  const adapter = {
    async createTopUpCheckout({ topUpId }) {
      const id = `cs_fixture_${sessions.size + 1}`;
      sessions.set(topUpId, id);
      return { id, url: `https://checkout.example/${id}` };
    },
    async retrieveTopUpCheckout() { return reported; },
    async verifyEvent(rawBody) { return JSON.parse(rawBody.toString()); },
    topUpEvent: (event) => event.facts
  };
  const service = createPaymentCheckoutService({
    appEnv: 'test', adapter, store, payments: {}, merchantScope, returnUrl: 'https://app.example/credits',
    authorize: async (actor, request) => actor === request.subjectId && request.action === 'topUp',
    topUps: {
      offer: configuration.topUps,
      credit: async (credit, options) => {
        await options.trx('conformance_credits').insert({ subject_id: credit.subjectId, amount: credit.amount, currency: credit.currency });
      }
    }
  });
  const named = new Map();
  const compare = (actual, expected) => {
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return assert.deepEqual(actual, expected);
    for (const [key, value] of Object.entries(expected)) compare(actual[key], value);
  };
  try {
    for (const step of scenario.steps) {
      const subject = step.subjectId ?? subjectId;
      let run;
      if (step.operation === 'topUp') {
        run = async () => {
          const started = await service.topUp({ actor: subject, subjectId: subject, ...step.input });
          named.set(step.topUp, started.topUpId);
          return started;
        };
      } else if (step.operation === 'settle') {
        const topUpId = named.get(step.topUp);
        reported = { ...step.facts, topUpId, sessionId: sessions.get(topUpId), paymentIntentId: null };
        run = step.door === 'webhook'
          ? () => service.webhook({ rawBody: Buffer.from(JSON.stringify({ facts: reported })), signature: 'fixture' })
          : () => service.confirmTopUp({ actor: subject, subjectId: subject, topUpId });
      } else {
        assert.equal(step.operation, 'credits');
        run = async () => (await db('conformance_credits').orderBy('id')).map((row) => ({ subjectId: row.subject_id, amount: row.amount, currency: row.currency }));
      }
      if (step.error) await assert.rejects(run(), { code: step.error }, JSON.stringify(step));
      else compare(await run(), step.expect);
    }
  } finally { await db.destroy(); }
});
