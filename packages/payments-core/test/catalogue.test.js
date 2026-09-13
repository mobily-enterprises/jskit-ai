import assert from 'node:assert/strict';
import test from 'node:test';
import knex from 'knex';
import migration from '../migrations/payments_core_initial.cjs';
import { createKnexPaymentStore } from '../src/server/knexStore.js';
import { createPaymentCatalogue } from '../src/server/catalogue.js';

const scope = { applicationId: 'app', integrationId: 'billing', providerAccountId: 'acct_a', environment: 'sandbox' };
const config = { environments: { sandbox: { integrationId: 'billing', providerAccountId: 'acct_a' } }, plans: {
  pro: { name: 'Pro', amount: 1200, currency: 'USD', interval: 'month', features: [], renewalCredits: 10 }
} };

test('reviewed catalogue publication preserves IDs, handles drift, and recovers a partial write', async () => {
  const db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
  await migration.up(db);
  const store = createKnexPaymentStore({ knex: db });
  const products = new Map(); const prices = new Map();
  let writes = 0; let failPrice = false;
  const adapter = {
    async createProduct({ name }) { const value = { id: `product-${products.size}`, name }; products.set(value.id, value); writes++; return value; },
    async renameProduct({ id, name }) { const value = { id, name }; products.set(id, value); writes++; return value; },
    async readProduct(id) { return products.get(id); },
    async createPrice(input) {
      const value = { ...input, active: true, id: `price-${prices.size}` }; prices.set(value.id, value); writes++;
      assert.equal((await store.inspectCatalogue(scope)).pending.action, 'create-price');
      if (failPrice) throw new Error('response lost after provider accepted price');
      return value;
    },
    async readPrice(id) { return prices.get(id); }
  };
  const make = (configuration = config) => createPaymentCatalogue({ store, adapter, scope, configuration });
  try {
    const first = await make().preview();
    assert.deepEqual(first.changes.map((item) => item.action), ['create-product', 'create-price']);
    assert.equal(writes, 0);
    await assert.rejects(make().publish({ reviewId: 'stale' }), { code: 'payment_catalogue_review_required' });
    await make().publish({ reviewId: first.reviewId });
    const stable = await make().preview();
    assert.deepEqual(stable.changes, []);
    await make().publish({ reviewId: stable.reviewId });
    assert.equal(writes, 2);
    const changed = structuredClone(config); changed.plans.pro.amount = 1500;
    failPrice = true;
    const review = await make(changed).preview();
    await assert.rejects(make(changed).publish({ reviewId: review.reviewId }), { code: 'payment_catalogue_uncertain' });
    const pending = await make(changed).preview();
    assert.equal(pending.pending.action, 'create-price');
    await assert.rejects(make(changed).publish({ reviewId: pending.reviewId }), { code: 'payment_catalogue_review_required' });
    assert.equal(writes, 3);
    await assert.rejects(make(changed).recover({ reviewId: pending.reviewId, providerId: 'price-0' }), { code: 'payment_catalogue_review_required' });
    await assert.rejects(make(changed).recover({ reviewId: review.reviewId, providerId: 'price-1' }), { code: 'payment_catalogue_review_required' });
    prices.get('price-1').active = false;
    await assert.rejects(make(changed).recover({ reviewId: pending.reviewId, providerId: 'price-1' }), { code: 'payment_catalogue_review_required' });
    prices.get('price-1').active = true;
    await make(changed).recover({ reviewId: pending.reviewId, providerId: 'price-1' });
    const state = await store.inspectCatalogue(scope);
    assert.equal(state.plans.pro.priceId, 'price-1');
    assert.equal(state.history[0].priceId, 'price-0');
    assert.deepEqual((await make(changed).preview()).changes, []);
    prices.get('price-1').active = false;
    const drift = await make(changed).preview();
    assert.equal(drift.drift.length, 1);
    await assert.rejects(make(changed).publish({ reviewId: drift.reviewId }), { code: 'payment_catalogue_review_required' });
    assert.deepEqual((await store.inspectCatalogue({ ...scope, environment: 'live' })).plans, {});
  } finally { await migration.down(db); await db.destroy(); }
});

test('sandbox and live publish independently and cannot reuse each other’s review', async () => {
  const db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
  await migration.up(db);
  const store = createKnexPaymentStore({ knex: db });
  const configuration = structuredClone(config);
  configuration.environments.live = { integrationId: 'billing-live', providerAccountId: 'acct_live' };
  const liveScope = { ...scope, environment: 'live', ...configuration.environments.live };
  const writes = [];
  const services = {};
  for (const selected of [scope, liveScope]) {
    const objects = new Map();
    const save = (kind, input) => {
      const value = { ...input, id: `${selected.environment}-${kind}`, active: true };
      objects.set(value.id, value);
      writes.push(value.id);
      return value;
    };
    services[selected.environment] = createPaymentCatalogue({ store, scope: selected, configuration, adapter: {
      async createProduct(input) { return save('product', input); },
      async createPrice(input) { return save('price', input); },
      async readProduct(id) { return objects.get(id); },
      async readPrice(id) { return objects.get(id); }
    } });
  }
  try {
    const sandboxReview = await services.sandbox.preview();
    const liveReview = await services.live.preview();
    assert.notEqual(sandboxReview.reviewId, liveReview.reviewId);
    await assert.rejects(services.live.publish({ reviewId: sandboxReview.reviewId }), { code: 'payment_catalogue_review_required' });
    assert.deepEqual(writes, []);
    await services.sandbox.publish({ reviewId: sandboxReview.reviewId });
    const sandboxState = await store.inspectCatalogue(scope);
    assert.deepEqual((await store.inspectCatalogue(liveScope)).plans, {});
    await services.live.publish({ reviewId: liveReview.reviewId });
    assert.deepEqual(await store.inspectCatalogue(scope), sandboxState);
    assert.equal(sandboxState.plans.pro.priceId, 'sandbox-price');
    assert.equal((await store.inspectCatalogue(liveScope)).plans.pro.priceId, 'live-price');
    for (const service of Object.values(services)) {
      const review = await service.preview();
      assert.deepEqual(review.changes, []);
      await service.publish({ reviewId: review.reviewId });
    }
    assert.deepEqual(writes, ['sandbox-product', 'sandbox-price', 'live-product', 'live-price']);
  } finally { await migration.down(db); await db.destroy(); }
});
