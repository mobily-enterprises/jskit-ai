import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import knex from 'knex';
import { validatePaymentConfiguration } from '@jskit-ai/payments-core/shared';
import { createPaymentService } from '@jskit-ai/payments-core/server';
import { createKnexPaymentStore } from '@jskit-ai/payments-core/server/storage';
import migration from '../migrations/payments_core_initial.cjs';

// No editor, Genesis project, network or generated application is involved.
test('a hand-written app reloads payment policy from disk while retaining its own billing state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'standalone-payments-'));
  const path = join(directory, 'integrations.json');
  const db = knex({ client: 'better-sqlite3', connection: { filename: join(directory, 'app.sqlite') }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
  const document = {
    integrations: { billing: { provider: 'stripe', accountMode: 'shared', authentication: { method: 'api-key', secretRef: 'env:STRIPE_KEY' } } },
    extensions: { payments: {
      version: 1,
      environments: { sandbox: { integrationId: 'billing', providerAccountId: 'acct_fixture', webhookSecretRef: 'env:STRIPE_WEBHOOK_SECRET', returnUrlRef: 'env:BILLING_RETURN_URL' } },
      plans: { pro: { name: 'Pro', amount: 1200, currency: 'USD', interval: 'month', features: ['export'], renewalCredits: 100 } }
    } }
  };
  const scope = { applicationId: 'hand-written-app', integrationId: 'billing', providerAccountId: 'acct_fixture', environment: 'sandbox', subjectId: 'workspace-a' };
  const boot = async () => createPaymentService({
    store: createKnexPaymentStore({ knex: db }),
    configuration: validatePaymentConfiguration(JSON.parse(await readFile(path, 'utf8'))),
    clock: () => 1000
  });
  try {
    await migration.up(db);
    await writeFile(path, JSON.stringify(document));
    const first = await boot();
    await createKnexPaymentStore({ knex: db }).bindCustomer(scope, 'cus_fixture', scope.subjectId);
    await first.reconcileEvent(scope, {
      eventId: 'evt_fixture', customerId: 'cus_fixture',
      load: async () => ({ subscription: { id: 'sub_fixture', status: 'active', planId: 'pro', periodEnd: 10000 }, renewal: { id: 'invoice_fixture', planId: 'pro', periodEnd: 10000 } })
    });
    await first.requireFeature(scope, 'export');
    await first.debitCredits(scope, { reference: 'job-1', units: 7 });
    document.extensions.payments.plans.pro.features = ['reports'];
    await writeFile(path, JSON.stringify(document));
    const restarted = await boot();
    assert.equal((await restarted.inspect(scope)).balance, 93);
    await restarted.requireFeature(scope, 'reports');
    await assert.rejects(restarted.requireFeature(scope, 'export'), { code: 'payment_feature_required' });
    assert.equal((await restarted.debitCredits(scope, { reference: 'job-1', units: 7 })).duplicate, true);
    assert.equal((await restarted.inspect(scope)).balance, 93);
    assert.equal((await restarted.inspect({ ...scope, subjectId: 'workspace-b' })).balance, 0);
    // A runtime instance uses an explicit snapshot, not an editor-managed watcher.
    await first.requireFeature(scope, 'export');
    document.extensions.payments.plans.pro.amount = -1;
    await writeFile(path, JSON.stringify(document));
    await assert.rejects(boot(), { code: 'payment_configuration_invalid' });
    assert.equal((await restarted.inspect(scope)).balance, 93);
  } finally {
    await db.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
