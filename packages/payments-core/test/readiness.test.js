import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentReadiness } from '../src/server/readiness.js';

const scope = { environment: 'live', providerAccountId: 'acct_a' };
const catalogue = { preview: async () => ({ environment: 'live', providerAccountId: 'acct_a', changes: [], drift: [], removed: [], pending: null }) };
const byId = (report) => Object.fromEntries(report.checks.map((check) => [check.id, check]));

test('readiness distinguishes provider facts, explicit app evidence and unknown checks without mutation', async () => {
  const adapter = { verifyAccount: async () => ({ environment: 'live', accountId: 'acct_a', chargesEnabled: true, payoutsEnabled: false }) };
  const readiness = createPaymentReadiness({ adapter, catalogue, scope,
    inspectApplication: async () => ({ webhook: { status: 'passed', detail: 'The configured route passed the signed fixture check.' } }) });
  const report = await readiness.inspect();
  assert.equal(report.providerAccountId, 'acct_a');
  const checks = byId(report);
  assert.equal(checks.credentials.status, 'passed');
  assert.equal(checks.account.status, 'passed');
  assert.equal(checks.charges.status, 'passed');
  assert.equal(checks.payouts.status, 'failed');
  assert.equal(checks.catalogue.status, 'passed');
  assert.equal(checks.webhook.status, 'passed');
  assert.equal(checks.checkout.status, 'unknown');
  assert.equal(checks.site.status, 'manual');
  assert.equal(checks.deployment.status, 'unknown');
  assert.equal(Object.hasOwn(report, 'ready'), false);
});

test('Paddle-style verification does not infer merchant approval; failed inspection does not leak provider errors', async () => {
  let catalogueReads = 0;
  const adapter = { verifyAccount: async () => ({ environment: 'live', credentialsVerified: true, accountIdentityVerified: false }) };
  const readiness = createPaymentReadiness({ adapter, catalogue: { preview: async () => { catalogueReads++; return { ...(await catalogue.preview()), changes: [{}] }; } }, scope });
  let checks = byId(await readiness.inspect());
  assert.equal(checks.credentials.status, 'passed');
  assert.equal(checks.account.status, 'manual');
  assert.equal(checks.charges.status, 'manual');
  assert.equal(checks.catalogue.status, 'failed');
  adapter.verifyAccount = async () => { throw new Error('sk_secret_must_not_escape'); };
  const failed = await readiness.inspect();
  checks = byId(failed);
  assert.equal(checks.credentials.status, 'failed');
  assert.equal(checks.catalogue.status, 'unknown');
  assert.equal(catalogueReads, 1);
  assert.doesNotMatch(JSON.stringify(failed), /sk_secret/);
});

test('readiness rejects merchant/environment substitution and malformed app evidence', async () => {
  const adapter = { verifyAccount: async () => ({ environment: 'sandbox', accountId: 'acct_a' }) };
  await assert.rejects(createPaymentReadiness({ adapter, catalogue, scope }).inspect(), { code: 'payment_scope_invalid' });
  adapter.verifyAccount = async () => ({ environment: 'live', accountId: 'acct_other' });
  await assert.rejects(createPaymentReadiness({ adapter, catalogue, scope }).inspect(), { code: 'payment_scope_invalid' });
  adapter.verifyAccount = async () => ({ environment: 'live' });
  assert.equal(byId(await createPaymentReadiness({ adapter, catalogue, scope }).inspect()).credentials.status, 'unknown');
  await assert.rejects(createPaymentReadiness({ adapter, catalogue, scope,
    inspectApplication: async () => ({ site: { status: 'approved', detail: 'Everything is fine' } }) }).inspect(), { code: 'payment_readiness_invalid' });
});
