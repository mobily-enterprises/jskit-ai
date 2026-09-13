import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv';
import knex from 'knex';
import migration from '../migrations/payments_core_initial.cjs';
import { validatePaymentConfiguration } from '../src/shared/configuration.js';
import { createPaymentService } from '../src/server/service.js';
import { createKnexPaymentStore } from '../src/server/knexStore.js';

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
    ['paddle-client-token-missing', 'publicClientTokenRef', /public client token/]
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
  const store = createKnexPaymentStore({ knex: db });
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
