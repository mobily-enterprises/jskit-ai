import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import Stripe from "stripe";
import { createPaddlePaymentAdapter } from "../src/server/paddle.js";
import { createPaymentCheckoutService } from "../src/server/checkout.js";
import { createStripePaymentAdapter } from "../src/server/stripe.js";
import { validatePaymentConfiguration } from "../src/shared/configuration.js";
import { TOP_UP_RETURN_PARAMETER } from "../src/shared/topUps.js";
import { startFakeStripe } from "./support/fakeStripe.js";
import { OFFER, RETURN_URL, createTopUpApp } from "./support/topUpApp.js";

// Prepaid top-ups end to end through the real Stripe SDK, against a stand-in for Stripe's API on this machine: a
// top-up starts for the subject the application authorized, within its limits; the verified webhook and the return
// page's confirmation both settle it through one path that credits a paid top-up once; and keys and stand-ins are
// refused where they would take or fake real money. The race of the two doors on one payment is proved on MariaDB
// (topUps.mysql.test.js), where two transactions truly run at once.

const TOP_UP_ID = /^[0-9a-f]{64}$/u;
const subject = (subjectId) => ({ actor: subjectId, subjectId });

/** A fresh application on its own in-memory database and its own stand-in for Stripe, closed after the test. */
async function topUpApp(t, options = {}) {
  const stripe = await startFakeStripe();
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
  t.after(async () => {
    await knex.destroy();
    await stripe.close();
  });
  return { stripe, knex, ...(await createTopUpApp(knex, stripe, options)) };
}

const sessionPosts = (stripe) => stripe.requests.filter(({ method, path }) => method === "POST" && path === "/v1/checkout/sessions");
const sessionReads = (stripe) => stripe.requests.filter(({ method, path }) => method === "GET" && path.startsWith("/v1/checkout/sessions/"));

test("a top-up starts only for a subject its actor may top up, as one Checkout payment per request", async (t) => {
  const { stripe, knex, service, authorizations, session } = await topUpApp(t);
  const request = { ...subject("tenant-a"), amount: 500, requestId: "top-up-1", email: "tenant@example.com" };

  await assert.rejects(service.topUp({ ...request, actor: "tenant-b" }), { code: "payment_forbidden", statusCode: 403 });
  await assert.rejects(service.confirmTopUp({ actor: "tenant-b", subjectId: "tenant-a", topUpId: "0".repeat(64) }), { code: "payment_forbidden" });
  assert.equal(stripe.requests.length, 0, "a refused actor reaches nothing at Stripe");
  assert.equal((await knex("payment_top_ups")).length, 0, "and writes nothing down");

  const started = await service.topUp(request);
  assert.deepEqual(authorizations.at(-1), { subjectId: "tenant-a", action: "topUp" });
  assert.match(started.topUpId, TOP_UP_ID);
  assert.deepEqual({ ...started, url: undefined }, { topUpId: started.topUpId, status: "open", amount: 500, currency: "USD", url: undefined });
  assert.equal(started.url, `${stripe.url}/pay/${session(started.topUpId).id}`);

  const paid = session(started.topUpId);
  const back = `${RETURN_URL}?${TOP_UP_RETURN_PARAMETER}=${started.topUpId}`;
  assert.equal(paid.mode, "payment");
  assert.deepEqual(paid.metadata, { jskit_top_up: started.topUpId });
  assert.deepEqual(paid.line_items, [{ quantity: "1", price_data: { currency: "usd", unit_amount: "500", product_data: { name: OFFER.name } } }]);
  assert.equal(paid.customer_email, "tenant@example.com");
  assert.equal(paid.payment_intent_data.receipt_email, "tenant@example.com");
  assert.deepEqual([paid.success_url, paid.cancel_url], [back, back], "Checkout comes back to the return page naming the top-up, paid or not");
  assert.equal(sessionPosts(stripe)[0].idempotencyKey, `top-up-${started.topUpId}`);
  assert.equal(sessionPosts(stripe)[0].authorization, `Bearer ${stripe.secretKey}`);

  assert.deepEqual(await service.topUp(request), started, "the same request answers the same top-up");
  assert.equal(sessionPosts(stripe).length, 1, "without asking Stripe again");
  await assert.rejects(service.topUp({ ...request, amount: 700 }), { code: "payment_reference_conflict", messageCode: "payments.reference.otherAmount" });
  const other = await service.topUp({ ...subject("tenant-b"), amount: 500, requestId: "top-up-1" });
  assert.notEqual(other.topUpId, started.topUpId, "another subject's same request id is a top-up of its own");
  assert.equal((await knex("payment_top_ups")).length, 2);
});

test("a top-up's amount is a whole number of cents within the application's limits", async (t) => {
  const { stripe, service } = await topUpApp(t);
  for (const amount of [OFFER.minimumAmount - 1, OFFER.maximumAmount + 1, 150.5, "500", -500, Number.NaN, null]) {
    await assert.rejects(service.topUp({ ...subject("tenant-a"), amount, requestId: "limits" }), { code: "payment_top_up_amount_invalid", statusCode: 422 }, String(amount));
  }
  assert.equal(stripe.requests.length, 0, "a refused amount reaches nothing at Stripe");
  assert.equal((await service.topUp({ ...subject("tenant-a"), amount: OFFER.minimumAmount, requestId: "smallest" })).amount, OFFER.minimumAmount);
  assert.equal((await service.topUp({ ...subject("tenant-a"), amount: OFFER.maximumAmount, requestId: "largest" })).amount, OFFER.maximumAmount);
  await assert.rejects(service.topUp({ ...subject("tenant-a"), amount: 500, requestId: "not valid!" }), { code: "payment_request_invalid" });
  await assert.rejects(service.topUp({ ...subject("tenant-a"), amount: 500, requestId: "described", description: "x".repeat(501) }), { code: "payment_input_invalid" });
});

test("the webhook credits a card payment once, however often Stripe reports it", async (t) => {
  const { stripe, service, credits, session, event } = await topUpApp(t);
  const { topUpId } = await service.topUp({ ...subject("tenant-a"), amount: 500, requestId: "card" });
  stripe.pay(session(topUpId).id);
  const settled = await service.webhook(event("checkout.session.completed", topUpId));
  assert.deepEqual(settled, { topUpId, status: "paid", amount: 500, currency: "USD", url: null, credited: true });
  assert.deepEqual(await credits("tenant-a"), [{ reference: `top-up:${topUpId}`, amount: 500, currency: "USD" }]);
  const replay = event("checkout.session.completed", topUpId);
  assert.equal((await service.webhook(replay)).credited, false, "a second delivery credits nothing");
  assert.equal((await service.webhook(replay)).credited, false, "nor a redelivery of the same event");
  assert.equal((await service.webhook(event("checkout.session.async_payment_failed", topUpId))).status, "paid", "a late failure never undoes a payment");
  assert.equal((await service.webhook(event("checkout.session.expired", topUpId, { status: "expired", payment_status: "unpaid" }))).status, "paid");
  assert.equal((await credits("tenant-a")).length, 1);
  assert.equal((await service.confirmTopUp({ ...subject("tenant-a"), topUpId })).credited, false, "the return page finds it paid");
  assert.equal(sessionReads(stripe).length, 0, "and asks Stripe nothing about a settled top-up");
});

test("the webhook credits a bank payment when it clears, and never when it fails or the page expires", async (t) => {
  const { stripe, service, credits, session, event } = await topUpApp(t);
  const cleared = await service.topUp({ ...subject("tenant-a"), amount: 800, requestId: "bank-ok" });
  stripe.clearing(session(cleared.topUpId).id);
  assert.deepEqual(await service.webhook(event("checkout.session.completed", cleared.topUpId)),
    { topUpId: cleared.topUpId, status: "processing", amount: 800, currency: "USD", url: null, credited: false });
  assert.deepEqual(await credits("tenant-a"), [], "a payment still clearing credits nothing");
  stripe.cleared(session(cleared.topUpId).id);
  assert.equal((await service.webhook(event("checkout.session.async_payment_succeeded", cleared.topUpId))).credited, true);
  assert.deepEqual(await credits("tenant-a"), [{ reference: `top-up:${cleared.topUpId}`, amount: 800, currency: "USD" }]);

  const failed = await service.topUp({ ...subject("tenant-a"), amount: 900, requestId: "bank-failed" });
  stripe.clearing(session(failed.topUpId).id);
  await service.webhook(event("checkout.session.completed", failed.topUpId));
  assert.deepEqual(await service.webhook(event("checkout.session.async_payment_failed", failed.topUpId)),
    { topUpId: failed.topUpId, status: "failed", amount: 900, currency: "USD", url: null, credited: false });
  assert.equal((await service.webhook(event("checkout.session.completed", failed.topUpId))).status, "failed", "a late report of the clearing payment leaves it failed");

  const expired = await service.topUp({ ...subject("tenant-a"), amount: 1000, requestId: "expired" });
  stripe.expire(session(expired.topUpId).id);
  assert.deepEqual(await service.webhook(event("checkout.session.expired", expired.topUpId)),
    { topUpId: expired.topUpId, status: "expired", amount: 1000, currency: "USD", url: null, credited: false });
  assert.equal((await service.confirmTopUp({ ...subject("tenant-a"), topUpId: expired.topUpId })).status, "expired");
  assert.equal((await credits("tenant-a")).length, 1, "only the cleared payment was credited");
});

test("a webhook credits the subject the top-up was written down for, and only for the session made for it", async (t) => {
  const { stripe, service, credits, session, event, knex } = await topUpApp(t);
  const { topUpId } = await service.topUp({ ...subject("tenant-a"), amount: 500, requestId: "owned" });
  const own = session(topUpId);
  stripe.pay(own.id);

  const signed = (changes) => stripe.event("checkout.session.completed", { ...own, ...changes });
  assert.deepEqual(await service.webhook(signed({ id: "cs_test_other" })), { ignored: true }, "another session naming the top-up is not its payment");
  assert.deepEqual(await service.webhook(signed({ client_reference_id: "f".repeat(64), metadata: { jskit_top_up: "f".repeat(64) } })), { ignored: true }, "a top-up never written down");
  assert.deepEqual(await service.webhook(signed({ client_reference_id: "order-17", metadata: {} })), { ignored: true }, "another Checkout payment on the account");
  await assert.rejects(service.webhook({ ...event("checkout.session.completed", topUpId), signature: "t=1,v1=forged" }), { code: "payment_signature_invalid" });
  await assert.rejects(service.webhook(signed({ amount_total: 50 })), { code: "payment_provider_result_invalid", messageCode: "payments.provider.topUpAmount" });
  await assert.rejects(service.webhook(signed({ currency: "eur" })), { code: "payment_provider_result_invalid", messageCode: "payments.provider.topUpAmount" });
  assert.deepEqual(await credits("tenant-a"), [], "nothing above credited anything");
  assert.equal(JSON.parse((await knex("payment_top_ups"))[0].payload).status, "open");

  const credited = await service.webhook(signed({ metadata: { jskit_top_up: topUpId, subjectId: "tenant-b" } }));
  assert.equal(credited.credited, true);
  assert.deepEqual(await credits("tenant-b"), [], "metadata names no subject");
  assert.equal((await credits("tenant-a")).length, 1);
});

test("a credit that fails leaves the top-up unpaid, and the next report credits it once", async (t) => {
  let failing = true;
  const { stripe, service, credits, session, event, knex } = await topUpApp(t, {
    credit: async (request, txOptions, write) => {
      await write(request, txOptions);
      if (failing) throw new Error("the balance service is down");
    }
  });
  const { topUpId } = await service.topUp({ ...subject("tenant-a"), amount: 500, requestId: "retry" });
  stripe.pay(session(topUpId).id);
  await assert.rejects(service.webhook(event("checkout.session.completed", topUpId)), /the balance service is down/);
  assert.deepEqual(await credits("tenant-a"), [], "the failed credit's own write rolled back with the settlement");
  assert.equal(JSON.parse((await knex("payment_top_ups"))[0].payload).status, "open");
  failing = false;
  assert.equal((await service.confirmTopUp({ ...subject("tenant-a"), topUpId })).credited, true);
  assert.equal((await service.webhook(event("checkout.session.completed", topUpId))).credited, false);
  assert.equal((await credits("tenant-a")).length, 1);
});

test("the return page's confirmation reads the session from Stripe with the server's key", async (t) => {
  const { stripe, service, credits, session } = await topUpApp(t);
  const { topUpId } = await service.topUp({ ...subject("tenant-a"), amount: 500, requestId: "return" });
  const open = await service.confirmTopUp({ ...subject("tenant-a"), topUpId });
  assert.deepEqual({ ...open, url: undefined }, { topUpId, status: "open", amount: 500, currency: "USD", url: undefined, credited: false });
  assert.match(open.url, /\/pay\/cs_test_/u, "an unpaid top-up offers its Checkout page again");
  assert.deepEqual(sessionReads(stripe).map(({ path, authorization }) => [path, authorization]),
    [[`/v1/checkout/sessions/${session(topUpId).id}`, `Bearer ${stripe.secretKey}`]]);

  stripe.clearing(session(topUpId).id);
  assert.deepEqual(await service.confirmTopUp({ ...subject("tenant-a"), topUpId }),
    { topUpId, status: "processing", amount: 500, currency: "USD", url: null, credited: false });
  assert.deepEqual(await credits("tenant-a"), []);
  stripe.cleared(session(topUpId).id);
  assert.equal((await service.confirmTopUp({ ...subject("tenant-a"), topUpId })).credited, true);
  assert.deepEqual(await credits("tenant-a"), [{ reference: `top-up:${topUpId}`, amount: 500, currency: "USD" }]);
  assert.equal((await service.confirmTopUp({ ...subject("tenant-a"), topUpId })).credited, false);
  assert.equal(sessionReads(stripe).length, 3, "a settled top-up answers without asking Stripe");

  const card = await service.topUp({ ...subject("tenant-a"), amount: 600, requestId: "return-card" });
  stripe.pay(session(card.topUpId).id);
  assert.deepEqual(await service.confirmTopUp({ ...subject("tenant-a"), topUpId: card.topUpId }),
    { topUpId: card.topUpId, status: "paid", amount: 600, currency: "USD", url: null, credited: true });

  for (const topUpId of [card.topUpId, "f".repeat(64), "../etc", 7]) {
    await assert.rejects(service.confirmTopUp({ ...subject("tenant-b"), topUpId }), { code: "payment_top_up_missing", statusCode: 404 }, String(topUpId));
  }
});

test("a live Stripe key is refused unless APP_ENV is production; test keys work everywhere", async () => {
  const options = { webhookSecret: "whsec_fixture", environment: "sandbox", providerAccountId: "acct_fixture", priceBindings: {} };
  for (const appEnv of ["development", "test", "staging"]) {
    for (const apiKey of ["sk_live_fixture", "rk_live_fixture"]) {
      assert.throws(() => createStripePaymentAdapter({ ...options, apiKey, appEnv }), (error) => {
        assert.equal(error.code, "payment_live_key_refused");
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /only APP_ENV=production .* use a test key \(sk_test_ or rk_test_\)/u);
        return true;
      }, `${apiKey} in ${appEnv}`);
    }
    assert.equal(typeof createStripePaymentAdapter({ ...options, apiKey: "sk_test_fixture", appEnv }).createTopUpCheckout, "function");
  }
  assert.equal(typeof createStripePaymentAdapter({ ...options, apiKey: "sk_live_fixture", appEnv: "production", environment: "live" }).createTopUpCheckout, "function");
  assert.equal(typeof createStripePaymentAdapter({ ...options, apiKey: "sk_test_fixture", appEnv: "production" }).verifyAccount, "function");
  for (const appEnv of [undefined, "", "prod", "Production"]) {
    assert.throws(() => createStripePaymentAdapter({ ...options, apiKey: "sk_test_fixture", appEnv }), { name: "TypeError", message: /Supply appEnv/u }, String(appEnv));
  }
});

test("a stand-in for Stripe's API is taken only in development and tests", async () => {
  const options = { apiKey: "sk_test_fixture", webhookSecret: "whsec_fixture", environment: "sandbox", providerAccountId: "acct_fixture", priceBindings: {} };
  for (const appEnv of ["staging", "production"]) {
    assert.throws(() => createStripePaymentAdapter({ ...options, appEnv, apiBaseUrl: "http://127.0.0.1:12111" }), { code: "payment_stand_in_refused", statusCode: 409 }, appEnv);
  }
  for (const apiBaseUrl of ["http://127.0.0.1:12111/v1", "http://user:secret@127.0.0.1:12111", "ftp://127.0.0.1", "http://127.0.0.1:12111/?x=1"]) {
    assert.throws(() => createStripePaymentAdapter({ ...options, appEnv: "test", apiBaseUrl }), { name: "TypeError", message: /stand-in's origin alone/u }, apiBaseUrl);
  }
  const stripe = await startFakeStripe({ secretKey: options.apiKey });
  try {
    const adapter = createStripePaymentAdapter({ ...options, appEnv: "development", apiBaseUrl: stripe.url, providerAccountId: stripe.accountId });
    assert.equal((await adapter.verifyAccount()).accountId, stripe.accountId);
    assert.deepEqual(stripe.requests.map(({ path }) => path), ["/v1/account", "/v1/balance"], "the SDK's requests went to the stand-in");
  } finally { await stripe.close(); }
});

test("a live merchant takes no top-up outside production", async () => {
  const adapter = createStripePaymentAdapter({ client: new Stripe("sk_test_unused"), appEnv: "staging", webhookSecret: "whsec_fixture", environment: "live", providerAccountId: "acct_live", priceBindings: {} });
  const service = createPaymentCheckoutService({
    appEnv: "staging",
    adapter,
    store: { withTopUp: async () => assert.fail("nothing is written down"), createTopUp: async () => assert.fail("nothing is written down") },
    payments: {},
    merchantScope: { applicationId: "app", integrationId: "billing", providerAccountId: "acct_live", environment: "live" },
    returnUrl: RETURN_URL,
    authorize: async () => true,
    topUps: { offer: OFFER, credit: async () => assert.fail("nothing is credited") }
  });
  await assert.rejects(service.topUp({ ...subject("tenant-a"), amount: 500, requestId: "live" }), { code: "payment_sandbox_only", statusCode: 409 });
});

test("a configuration sells plans, top-ups or both; one selling nothing is told about its empty plans first", () => {
  const document = (payments) => ({
    integrations: { billing: { provider: "stripe", accountMode: "shared", authentication: { method: "api-key", secretRef: "env:STRIPE_KEY" } } },
    extensions: { payments: { version: 1, environments: { sandbox: { integrationId: "billing", providerAccountId: "acct_fixture", webhookSecretRef: "env:STRIPE_WEBHOOK_SECRET", returnUrlRef: "env:APP_URL" } }, ...payments } }
  });
  assert.deepEqual(validatePaymentConfiguration(document({ plans: {}, topUps: OFFER })).topUps, OFFER);
  assert.throws(() => validatePaymentConfiguration(document({ plans: {} })), (error) => {
    assert.equal(error.code, "payment_configuration_invalid");
    assert.deepEqual(error.fieldErrors[0], { path: "extensions.payments/plans", message: "must NOT have fewer than 1 properties" },
      "the first error, which an editor shows above the form, is the one it showed before top-ups existed");
    return true;
  });
  for (const topUps of [{ ...OFFER, minimumAmount: 49 }, { ...OFFER, maximumAmount: 100000000 }, { ...OFFER, currency: "usd" }, { ...OFFER, name: "" }, { ...OFFER, minimumAmount: 100.5 }, { ...OFFER, extra: true }]) {
    assert.throws(() => validatePaymentConfiguration(document({ plans: {}, topUps })), { code: "payment_configuration_invalid" }, JSON.stringify(topUps));
  }
  assert.throws(() => validatePaymentConfiguration(document({ plans: {}, topUps: { ...OFFER, minimumAmount: 5000, maximumAmount: 1000 } })), (error) => {
    assert.deepEqual(error.fieldErrors, [{ path: "extensions.payments/topUps/maximumAmount", message: "Make the largest top-up at least the smallest.", code: "payments.configuration.topUpRange", params: {} }]);
    return true;
  });
});

test("top-ups are Stripe's: a Paddle connection with top-ups fails validation and composition, naming the fix", async (t) => {
  const document = {
    integrations: { billing: { provider: "paddle", accountMode: "shared", authentication: { method: "api-key", secretRef: "env:PADDLE_KEY" }, settings: { environment: "sandbox" } } },
    extensions: { payments: {
      version: 1,
      environments: { sandbox: { integrationId: "billing", providerAccountId: "acct_fixture", webhookSecretRef: "env:PADDLE_WEBHOOK_SECRET", returnUrlRef: "env:APP_URL", taxCategory: "saas", publicClientTokenRef: "env:PADDLE_CLIENT_TOKEN" } },
      plans: {},
      topUps: OFFER
    } }
  };
  assert.throws(() => validatePaymentConfiguration(document), (error) => {
    assert.equal(error.code, "payment_configuration_invalid");
    assert.deepEqual(error.fieldErrors, [{
      path: "extensions.payments/environments/sandbox/integrationId",
      message: "Top-ups take Stripe Checkout payments: select a Stripe connection for sandbox, or remove topUps.",
      code: "payments.configuration.paddleTopUps",
      params: { environment: "sandbox" }
    }]);
    return true;
  });
  const paddle = createPaddlePaymentAdapter({ client: {}, webhookSecret: "fixture", environment: "sandbox", priceBindings: {} });
  const { store } = await topUpApp(t);
  assert.throws(() => createPaymentCheckoutService({
    appEnv: "test", adapter: paddle, store, payments: {}, merchantScope: { applicationId: "app", integrationId: "billing", providerAccountId: "acct_fixture", environment: "sandbox" },
    returnUrl: RETURN_URL, authorize: async () => true, topUps: { offer: OFFER, credit: async () => {} }
  }), { name: "TypeError", message: /Paddle has no top-ups/u });
});

test("a service composed without top-ups refuses them, and with them requires the offer and the credit", async (t) => {
  const { service } = await topUpApp(t, { topUps: undefined });
  await assert.rejects(service.topUp({ ...subject("tenant-a"), amount: 500, requestId: "none" }), { code: "payment_top_ups_unavailable", statusCode: 409 });
  await assert.rejects(service.confirmTopUp({ ...subject("tenant-a"), topUpId: "f".repeat(64) }), { code: "payment_top_ups_unavailable" });
  for (const [topUps, message] of [
    [null, /topUps\.offer/u],
    [{ credit: async () => {} }, /topUps\.offer/u],
    [{ offer: { ...OFFER, currency: undefined }, credit: async () => {} }, /topUps\.offer/u],
    [{ offer: OFFER }, /topUps\.credit/u]
  ]) {
    await assert.rejects(topUpApp(t, { topUps }), { name: "TypeError", message });
  }
});
