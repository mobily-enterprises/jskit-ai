import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import knex from 'knex';
import Stripe from 'stripe';
import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import migration from '../migrations/payments_core_initial.cjs';
import { createKnexPaymentStore } from '../src/server/knexStore.js';
import { createPaymentService } from '../src/server/service.js';
import { createPaymentCheckoutService } from '../src/server/checkout.js';
import { createStripePaymentAdapter } from '../src/server/stripe.js';
import { createPaddlePaymentAdapter } from '../src/server/paddle.js';

const scope = { applicationId: 'app', integrationId: 'billing', providerAccountId: 'acct_a', environment: 'sandbox' };
const secret = 'test-signing-secret';

test('official SDK signature verification rejects mutation and expired delivery for both providers', async () => {
  const stripeClient = new Stripe('sk_test_fixture', { maxNetworkRetries: 0 });
  const stripe = createStripePaymentAdapter({ client: stripeClient, webhookSecret: secret, environment: 'sandbox', providerAccountId: 'acct_a', priceBindings: { pro: 'price_a' } });
  const raw = Buffer.from(JSON.stringify({ id: 'evt_a', type: 'customer.created', livemode: false, data: { object: { id: 'cus_a' } } }));
  const header = stripeClient.webhooks.generateTestHeaderString({ payload: raw.toString(), secret });
  assert.equal((await stripe.verifyEvent(raw, header)).id, 'evt_a');
  await assert.rejects(stripe.verifyEvent(Buffer.concat([raw, Buffer.from(' ')]), header), { code: 'payment_signature_invalid' });
  await assert.rejects(stripe.verifyEvent(raw, stripeClient.webhooks.generateTestHeaderString({ payload: raw.toString(), secret, timestamp: 1 })), { code: 'payment_signature_invalid' });
  await assert.rejects(stripe.verifyEvent(raw.toString(), header), { code: 'payment_signature_invalid' });
  const paddleClient = new Paddle('test-fixture', { environment: Environment.sandbox });
  const paddle = createPaddlePaymentAdapter({ client: paddleClient, webhookSecret: secret, environment: 'sandbox', priceBindings: { pro: 'pri_a' } });
  const paddleRaw = Buffer.from(JSON.stringify({ event_id: 'evt_a', event_type: 'customer.created', occurred_at: new Date().toISOString(), data: { id: 'ctm_a', email: 'test@example.com', status: 'active', marketing_consent: false, custom_data: null, import_meta: null } }));
  const signature = (ts) => `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${paddleRaw.toString()}`).digest('hex')}`;
  const currentSignature = signature(Math.floor(Date.now() / 1000));
  assert.equal((await paddle.verifyEvent(paddleRaw, currentSignature)).eventId, 'evt_a');
  await assert.rejects(paddle.verifyEvent(Buffer.concat([paddleRaw, Buffer.from(' ')]), currentSignature), { code: 'payment_signature_invalid' });
  await assert.rejects(paddle.verifyEvent(paddleRaw, signature(1)), { code: 'payment_signature_invalid' });
});

test('checkout authorizes before provider access, persists intent, deduplicates requests and needs explicit recovery', async () => {
  const db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
  await migration.up(db);
  const store = createKnexPaymentStore({ knex: db });
  let creates = 0;
  let fails = false;
  const adapter = {
    validatePlan(planId) { assert.equal(planId, 'pro'); },
    async createCustomer() { creates++; return 'cus_a'; },
    async createCheckout() {
      creates++;
      assert.equal((await store.inspect({ ...scope, subjectId: 'tenant-a' })).pendingPaymentOperation.action, 'checkout');
      if (fails) throw new Error('uncertain provider timeout');
      return { id: 'cs_a', url: 'https://checkout.stripe.com/example' };
    },
    async createPortal() { return { id: 'portal_a', url: 'https://billing.stripe.com/example' }; }
  };
  const service = createPaymentCheckoutService({ adapter, store, payments: { inspect: async () => ({ balance: 0, features: [], subscriptions: [] }) }, merchantScope: scope, returnUrl: 'https://app.example/billing', authorize: async (actor, { subjectId }) => actor === subjectId });
  const input = { actor: 'tenant-a', subjectId: 'tenant-a', email: 'tenant@example.com', planId: 'pro', requestId: 'request-1' };
  try {
    await assert.rejects(service.checkout({ ...input, actor: 'tenant-b' }), { code: 'payment_forbidden' });
    assert.equal(creates, 0);
    await assert.rejects(service.reconcilePending({ actor: 'tenant-b', subjectId: 'tenant-a', inspectProvider: async () => { assert.fail('denied recovery cannot inspect the provider'); } }), { code: 'payment_forbidden' });
    assert.equal((await db('payment_accounts')).length, 0, 'denied operations create no account state');
    await assert.rejects(service.account({ actor: 'tenant-b', subjectId: 'tenant-a' }), { code: 'payment_forbidden' });
    assert.deepEqual(await service.account({ actor: 'tenant-a', subjectId: 'tenant-a' }), { balance: 0, features: [], subscriptions: [], hasCustomer: false });
    assert.equal((await service.checkout(input)).id, 'cs_a');
    assert.equal((await service.checkout(input)).id, 'cs_a');
    assert.equal(creates, 2);
    assert.equal((await service.account({ actor: 'tenant-a', subjectId: 'tenant-a' })).hasCustomer, true);
    assert.equal(await store.resolveCustomer(scope, 'cus_a'), 'tenant-a');
    await assert.rejects(service.portal({ actor: 'tenant-b', subjectId: 'tenant-a' }), { code: 'payment_forbidden' });
    fails = true;
    await assert.rejects(service.checkout({ ...input, requestId: 'request-2' }), { code: 'payment_operation_uncertain' });
    await assert.rejects(service.checkout({ ...input, requestId: 'request-2' }), { code: 'payment_operation_uncertain' });
    assert.equal(creates, 3);
    await assert.rejects(service.reconcilePending({ actor: 'tenant-a', subjectId: 'tenant-a', inspectProvider: async () => ({}) }), { code: 'payment_reconciliation_required' });
    await service.reconcilePending({ actor: 'tenant-a', subjectId: 'tenant-a', inspectProvider: async () => ({ result: { id: 'cs_recovered', url: 'https://checkout.stripe.com/recovered' } }) });
    assert.equal((await service.checkout({ ...input, requestId: 'request-2' })).id, 'cs_recovered');
    await store.withAccount({ ...scope, subjectId: 'tenant-a' }, async (tx) => {
      tx.state.subscriptions.sub_a = { id: 'sub_a', status: 'past_due', planId: 'pro', periodEnd: 0 };
    });
    await assert.rejects(service.checkout({ ...input, requestId: 'request-3' }), { code: 'payment_subscription_exists' });
    // A lost response can still be recovered using its original intent identity.
    assert.equal((await service.checkout(input)).id, 'cs_a');
    assert.equal(creates, 3);
  } finally { await migration.down(db); await db.destroy(); }
});

test('Stripe reconciliation loads current subscription and validates invoice account, quantity and price', async () => {
  const subscription = { id: 'sub_a', customer: 'cus_a', livemode: false, status: 'active', items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_a' }, current_period_end: 20000 }] } };
  const invoice = { id: 'in_a', customer: 'cus_a', livemode: false, status: 'paid', billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: 'sub_a' } }, lines: { has_more: false, data: [{ quantity: 1, parent: { subscription_item_details: { proration: false } }, pricing: { price_details: { price: 'price_a' } }, period: { end: 20000 } }] } };
  const client = { accounts: { retrieve: async () => ({ id: 'acct_a' }) }, balance: { retrieve: async () => ({ livemode: false }) }, subscriptions: { retrieve: async () => subscription }, invoices: { retrieve: async () => invoice } };
  const adapter = createStripePaymentAdapter({ client, webhookSecret: secret, environment: 'sandbox', providerAccountId: 'acct_a', priceBindings: { pro: 'price_a' } });
  const event = { type: 'invoice.paid', data: { object: { id: 'in_a' } } };
  assert.equal((await adapter.loadEvent(event)).renewal.planId, 'pro');
  invoice.status = 'open';
  subscription.status = 'past_due';
  event.type = 'invoice.payment_failed';
  const failed = await adapter.loadEvent(event);
  assert.equal(failed.subscription.status, 'past_due');
  assert.equal(failed.renewal, undefined);
  // A delayed failure delivery reads current provider state after recovery.
  invoice.status = 'paid';
  subscription.status = 'active';
  assert.equal((await adapter.loadEvent(event)).renewal.id, 'in_a');
  subscription.status = 'canceled';
  assert.equal((await adapter.loadEvent(event)).subscription.status, 'canceled');
  invoice.billing_reason = 'subscription_update';
  assert.equal((await adapter.loadEvent(event)).renewal, undefined);
  invoice.customer = 'cus_other';
  await assert.rejects(adapter.loadEvent(event), { code: 'payment_provider_result_invalid' });
});

test('signed standalone Stripe invoices are ignored before customer lookup; malformed and tampered events fail', async () => {
  const client = new Stripe('sk_test_fixture', { maxNetworkRetries: 0 });
  const adapter = createStripePaymentAdapter({ client, webhookSecret: secret, environment: 'sandbox', providerAccountId: 'acct_a', priceBindings: {} });
  let reconciliations = 0;
  const service = createPaymentCheckoutService({ adapter, merchantScope: scope, returnUrl: 'https://app.example/billing', authorize: async () => false,
    payments: { async reconcileEvent() { reconciliations++; } } });
  const event = { id: 'evt_oneoff', type: 'invoice.paid', livemode: false, data: { object: { id: 'in_oneoff', customer: 'cus_unrelated', parent: null } } };
  const rawBody = Buffer.from(JSON.stringify(event));
  const signature = client.webhooks.generateTestHeaderString({ payload: rawBody.toString(), secret });
  assert.deepEqual(await service.webhook({ rawBody, signature }), { ignored: true });
  assert.equal(reconciliations, 0);
  await assert.rejects(service.webhook({ rawBody: Buffer.concat([rawBody, Buffer.from(' ')]), signature }), { code: 'payment_signature_invalid' });
  delete event.data.object.parent;
  assert.throws(() => adapter.eventIdentity(event), { code: 'payment_provider_result_invalid' });
  event.type = 'invoice.payment_failed';
  event.data.object.parent = { subscription_details: { subscription: 'sub_a' } };
  assert.deepEqual(adapter.eventIdentity(event), { eventId: 'evt_oneoff', customerId: 'cus_unrelated' });
});

test('Paddle event identity separates standalone transactions from subscription updates', () => {
  const adapter = createPaddlePaymentAdapter({ client: {}, webhookSecret: secret, environment: 'sandbox', priceBindings: {} });
  const event = { eventId: 'evt_a', eventType: 'transaction.completed', data: { subscriptionId: null, customerId: 'ctm_a' } };
  assert.equal(adapter.eventIdentity(event), null);
  delete event.data.subscriptionId;
  assert.throws(() => adapter.eventIdentity(event), { code: 'payment_provider_result_invalid' });
  event.data.subscriptionId = 'sub_a';
  assert.deepEqual(adapter.eventIdentity(event), { eventId: 'evt_a', customerId: 'ctm_a' });
  event.eventType = 'subscription.past_due';
  assert.deepEqual(adapter.eventIdentity(event), { eventId: 'evt_a', customerId: 'ctm_a' });
  event.eventType = 'customer.created';
  assert.equal(adapter.eventIdentity(event), null);
});

test('Paddle reconciliation uses current status and grants only qualifying completed renewals', async () => {
  const subscription = { id: 'sub_a', customerId: 'ctm_a', status: 'active', items: [{ quantity: 1, price: { id: 'pri_a' } }], currentBillingPeriod: { endsAt: '2030-01-01T00:00:00Z' } };
  const transaction = { id: 'txn_a', customerId: 'ctm_a', subscriptionId: 'sub_a', status: 'completed', origin: 'subscription_recurring', items: [{ quantity: 1, price: { id: 'pri_a' }, proration: null }], billingPeriod: { endsAt: '2030-01-01T00:00:00Z' } };
  const client = { subscriptions: { get: async () => subscription }, transactions: { get: async () => transaction } };
  const adapter = createPaddlePaymentAdapter({ client, webhookSecret: secret, environment: 'sandbox', priceBindings: { pro: 'pri_a' } });
  const event = { eventType: 'transaction.completed', data: { id: 'txn_a' } };
  assert.equal((await adapter.loadEvent(event)).renewal.id, 'txn_a');
  transaction.origin = 'subscription_update';
  assert.equal((await adapter.loadEvent(event)).renewal, undefined);
  subscription.status = 'paused';
  subscription.currentBillingPeriod = null;
  const paused = await adapter.loadEvent({ eventType: 'subscription.updated', data: { id: 'sub_a' } });
  assert.equal(paused.subscription.status, 'paused');
  assert.equal(paused.subscription.periodEnd, 0);
  assert.equal(paused.renewal, undefined);
  transaction.customerId = 'ctm_other';
  await assert.rejects(adapter.loadEvent(event), { code: 'payment_provider_result_invalid' });
});


test('signed subscription lifecycle updates app access without crossing subjects or environments', async () => {
  const db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
  await migration.up(db);
  const store = createKnexPaymentStore({ knex: db });
  const stripeSdk = new Stripe('sk_test_fixture', { maxNetworkRetries: 0 });
  const paddleSdk = new Paddle('test-fixture', { environment: Environment.sandbox });
  try {
    for (const provider of ['stripe', 'paddle']) {
      const merchant = { ...scope, applicationId: provider };
      const subject = { ...merchant, subjectId: 'tenant-a' };
      let now = Date.parse('2030-01-01T00:00:00Z');
      const end = Date.parse('2030-02-01T00:00:00Z');
      let status = 'active';
      let customerId = 'customer_a';
      let loads = 0;
      const payments = createPaymentService({ store, clock: () => now, configuration: {
        environments: { sandbox: { integrationId: merchant.integrationId, providerAccountId: merchant.providerAccountId } },
        plans: { pro: { features: ['export'], renewalCredits: 100 } }
      } });
      const adapter = provider === 'stripe'
        ? createStripePaymentAdapter({ webhookSecret: secret, environment: 'sandbox', providerAccountId: 'acct_a', priceBindings: { pro: 'price_a' }, client: {
          webhooks: stripeSdk.webhooks,
          accounts: { retrieve: async () => ({ id: 'acct_a' }) }, balance: { retrieve: async () => ({ livemode: false }) },
          subscriptions: { retrieve: async () => { loads++; return { id: 'sub_a', customer: customerId, livemode: false, status, items: { has_more: false, data: [{ quantity: 1, price: { id: 'price_a' }, current_period_end: end / 1000 }] } }; } }
        } })
        : createPaddlePaymentAdapter({ webhookSecret: secret, environment: 'sandbox', priceBindings: { pro: 'pri_a' }, client: {
          webhooks: paddleSdk.webhooks,
          subscriptions: { get: async () => { loads++; return { id: 'sub_a', customerId, status, items: [{ quantity: 1, price: { id: 'pri_a' } }], currentBillingPeriod: { endsAt: new Date(end).toISOString() } }; } }
        } });
      const checkout = createPaymentCheckoutService({ adapter, store, payments, merchantScope: merchant, returnUrl: 'https://app.example/billing', authorize: async () => false });
      await store.bindCustomer(merchant, 'customer_a', 'tenant-a');
      const deliver = async (id, eventCustomer = 'customer_a') => {
        const payload = provider === 'stripe'
          ? { id, type: 'customer.subscription.updated', livemode: false, data: { object: { id: 'sub_a', customer: eventCustomer } } }
          : { event_id: id, event_type: 'subscription.updated', occurred_at: new Date().toISOString(), data: { id: 'sub_a', customer_id: eventCustomer, billing_cycle: { interval: 'month', frequency: 1 }, items: [] } };
        const rawBody = Buffer.from(JSON.stringify(payload));
        const ts = Math.floor(Date.now() / 1000);
        const signature = provider === 'stripe'
          ? stripeSdk.webhooks.generateTestHeaderString({ payload: rawBody.toString(), secret })
          : `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${rawBody.toString()}`).digest('hex')}`;
        return checkout.webhook({ rawBody, signature });
      };
      for (const [index, next] of ['active', 'past_due', 'active', 'paused', 'canceled'].entries()) {
        status = next;
        await deliver(`event_${index}`);
        const state = await payments.inspect(subject);
        assert.deepEqual(state.features, next === 'active' ? ['export'] : [], `${provider}: ${next}`);
        assert.equal(state.balance, 0, 'a subscription event alone never grants renewal credits');
        assert.equal((await payments.inspect({ ...subject, subjectId: 'tenant-b' })).subscriptions.length, 0);
        assert.equal((await store.inspect({ ...subject, environment: 'live' })).subscriptions.sub_a, undefined);
      }
      const previousLoads = loads;
      assert.equal((await deliver('event_4')).duplicate, true);
      assert.equal(loads, previousLoads, 'duplicate delivery does not call the provider again');
      customerId = 'customer_other';
      await assert.rejects(deliver('event_foreign'), { code: 'payment_provider_result_invalid' });
      assert.equal((await payments.inspect(subject)).subscriptions[0].status, 'canceled');
      customerId = 'customer_a';
      status = 'active';
      await deliver('event_foreign'); // failed verification must not commit a receipt
      await payments.requireFeature(subject, 'export');
      now = end;
      await assert.rejects(payments.requireFeature(subject, 'export'), { code: 'payment_feature_required' });
      await assert.rejects(deliver('event_unbound', 'customer_unbound'), { code: 'payment_customer_unbound' });
    }
  } finally { await migration.down(db); await db.destroy(); }
});
