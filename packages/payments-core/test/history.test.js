import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentCheckoutService } from '../src/server/checkout.js';
import { createStripePaymentAdapter } from '../src/server/stripe.js';
import { createPaddlePaymentAdapter } from '../src/server/paddle.js';

const merchant = { applicationId: 'app', integrationId: 'billing', providerAccountId: 'acct_a', environment: 'sandbox' };

test('every subject billing entry point requires explicit authorization before touching state', async () => {
  const touched = [];
  const forbidden = new Proxy({}, { get(_target, key) { touched.push(key); throw new Error('Unauthorized dependency access'); } });
  const actions = { account: 'account', history: 'history', checkout: 'checkout', portal: 'portal', reconcilePending: 'reconcile' };
  for (const decision of [false, undefined, null, 'true', 1, { allowed: true }]) {
    const requests = [];
    const service = createPaymentCheckoutService({ merchantScope: merchant, returnUrl: 'https://example.com/billing',
      store: forbidden, adapter: forbidden, payments: forbidden,
      authorize: async (actor, request) => { requests.push({ actor, ...request }); return decision; }
    });
    for (const [method, action] of Object.entries(actions)) {
      await assert.rejects(service[method]({ actor: 'editor-owner', subjectId: 'tenant-a',
        collection: 'transactions', email: 'person@example.com', planId: 'pro', requestId: 'request-a',
        inspectProvider: async () => { touched.push('provider-inspection'); }
      }), { code: 'payment_forbidden' });
      assert.deepEqual(requests.at(-1), { actor: 'editor-owner', subjectId: 'tenant-a', action });
    }
  }
  assert.deepEqual(touched, [], 'denied calls cannot read state, contact providers or inspect recovery');
});

test('history authorizes the subject before storage or network and never accepts a caller customer ID', async () => {
  const reads = [];
  let boundCustomer = 'cus_owned';
  const service = createPaymentCheckoutService({ merchantScope: merchant, returnUrl: 'https://example.com/billing',
    authorize: async (actor, request) => actor === 'billing-admin' && request.subjectId === 'tenant-a' && request.action === 'history',
    store: { async inspect(scope) { reads.push(scope); return { customerId: boundCustomer }; } },
    adapter: { async readHistory(query) { reads.push(query); return { collection: query.collection, items: [], nextCursor: null }; } }
  });
  await assert.rejects(service.history({ actor: 'tenant-b', subjectId: 'tenant-a', collection: 'transactions' }), { code: 'payment_forbidden' });
  await assert.rejects(service.history({ actor: 'billing-admin', subjectId: 'tenant-b', collection: 'transactions' }), { code: 'payment_forbidden' });
  assert.equal(reads.length, 0);
  const input = { actor: 'billing-admin', subjectId: 'tenant-a', collection: 'transactions' };
  await assert.rejects(service.history({ ...input, after: 'https://attacker.example' }), { code: 'payment_input_invalid' });
  await assert.rejects(service.history({ ...input, collection: 'customers' }), { code: 'payment_input_invalid' });
  assert.equal(reads.length, 0);
  await service.history({ ...input, customerId: 'cus_attacker', after: 'in_previous' });
  assert.deepEqual(reads, [{ ...merchant, subjectId: 'tenant-a' }, { customerId: 'cus_owned', collection: 'transactions', after: 'in_previous' }]);
  boundCustomer = null;
  reads.length = 0;
  assert.deepEqual(await service.history(input), { collection: 'transactions', items: [], nextCursor: null });
  assert.equal(reads.length, 1);
});

test('history errors do not expose provider credentials or diagnostics', async () => {
  const service = createPaymentCheckoutService({ merchantScope: merchant, returnUrl: 'https://example.com/billing', authorize: async () => true,
    store: { inspect: async () => ({ customerId: 'cus_a' }) }, adapter: { readHistory: async () => { throw new Error('sk_secret customer_private@example.com'); } } });
  await assert.rejects(service.history({ actor: 'admin', subjectId: 'a', collection: 'transactions' }), (error) => {
    assert.equal(error.code, 'payment_history_unavailable');
    assert.doesNotMatch(error.message, /sk_secret|customer_private/);
    return true;
  });
});

test('Stripe history uses customer-filtered single pages, includes canceled subscriptions, and projects billing facts only', async () => {
  const queries = [];
  const invoice = { id: 'in_a', customer: 'cus_a', livemode: false, created: 1700000000, status: 'open', total: 1200, amount_paid: 0, currency: 'usd', customer_email: 'private@example.com', metadata: { secret: 'hidden' }, hosted_invoice_url: 'https://private.example' };
  let accountId = 'acct_a';
  const client = { accounts: { retrieve: async () => ({ id: accountId }) }, balance: { retrieve: async () => ({ livemode: false }) },
    invoices: { list: async (query) => { queries.push(query); return { data: [invoice], has_more: true }; } },
    subscriptions: { list: async (query) => { queries.push(query); return { data: [{ id: 'sub_a', customer: 'cus_a', livemode: false, created: 1700000000, status: 'canceled', metadata: { hidden: true } }], has_more: false }; } } };
  const adapter = createStripePaymentAdapter({ client, webhookSecret: 'fixture', environment: 'sandbox', providerAccountId: 'acct_a', priceBindings: {} });
  const result = await adapter.readHistory({ customerId: 'cus_a', collection: 'transactions', after: 'in_previous' });
  assert.deepEqual(queries[0], { customer: 'cus_a', limit: 20, starting_after: 'in_previous' });
  assert.deepEqual(result, { collection: 'transactions', items: [{ id: 'in_a', kind: 'invoice', status: 'open', createdAt: '2023-11-14T22:13:20.000Z', currency: 'USD', totalMinor: '1200', paidMinor: '0' }], nextCursor: 'in_a' });
  assert.equal((await adapter.readHistory({ customerId: 'cus_a', collection: 'subscriptions' })).items[0].status, 'canceled');
  assert.deepEqual(queries[1], { customer: 'cus_a', limit: 20, status: 'all' });
  invoice.customer = 'cus_other';
  await assert.rejects(adapter.readHistory({ customerId: 'cus_a', collection: 'transactions' }), { code: 'payment_provider_result_invalid' });
  invoice.customer = 'cus_a';
  invoice.livemode = true;
  await assert.rejects(adapter.readHistory({ customerId: 'cus_a', collection: 'transactions' }), { code: 'payment_provider_result_invalid' });
  accountId = 'acct_other';
  const prior = queries.length;
  await assert.rejects(adapter.readHistory({ customerId: 'cus_a', collection: 'transactions' }), { code: 'payment_provider_result_invalid' });
  assert.equal(queries.length, prior);
});

test('Paddle history preserves amount strings, distinguishes unpaid totals and fetches one customer-filtered page', async () => {
  let pages = 0;
  const queries = [];
  const record = { id: 'txn_a', customerId: 'ctm_a', status: 'billed', createdAt: '2030-01-01T00:00:00Z', currencyCode: 'USD', details: { totals: { total: '9007199254740993' } }, checkout: { url: 'https://private.example' }, customData: { secret: 'hidden' } };
  const list = (query) => { queries.push(query); return { hasMore: true, async next() { pages++; return [record]; } }; };
  const adapter = createPaddlePaymentAdapter({ client: { transactions: { list }, subscriptions: { list } }, webhookSecret: 'fixture', environment: 'sandbox', priceBindings: {} });
  assert.deepEqual(await adapter.readHistory({ customerId: 'ctm_a', collection: 'transactions', after: 'txn_previous' }), {
    collection: 'transactions', items: [{ id: 'txn_a', kind: 'transaction', status: 'billed', createdAt: '2030-01-01T00:00:00.000Z', currency: 'USD', totalMinor: '9007199254740993', paidMinor: null }], nextCursor: 'txn_a'
  });
  assert.equal(pages, 1);
  assert.deepEqual(queries[0], { customerId: ['ctm_a'], perPage: 20, after: 'txn_previous' });
  record.details = null;
  assert.equal((await adapter.readHistory({ customerId: 'ctm_a', collection: 'transactions' })).items[0].totalMinor, null);
  record.id = 'sub_a';
  record.status = 'canceled';
  assert.deepEqual((await adapter.readHistory({ customerId: 'ctm_a', collection: 'subscriptions' })).items[0], { id: 'sub_a', kind: 'subscription', status: 'canceled', createdAt: '2030-01-01T00:00:00.000Z' });
  record.customerId = 'ctm_other';
  await assert.rejects(adapter.readHistory({ customerId: 'ctm_a', collection: 'transactions' }), { code: 'payment_provider_result_invalid' });
});
