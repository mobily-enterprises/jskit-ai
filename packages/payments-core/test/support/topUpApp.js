import { createPaymentCheckoutService } from "../../src/server/checkout.js";
import { createStripePaymentAdapter } from "../../src/server/stripe.js";
import { migratePayments } from "./migrations.js";
import { createTestPaymentStore } from "./paymentStore.js";

// An application that takes top-ups, as one composes them: the payment store on its own database, the Stripe adapter
// on the real Stripe SDK talking to a stand-in for Stripe's API (fakeStripe.js), and its checkout service with a
// credit function that writes each credit as a row of its own balance table, in the transaction that settles the
// top-up. The balance table has no unique reference on purpose, so a top-up credited twice shows as two rows.

const OFFER = Object.freeze({ name: "Credits", currency: "USD", minimumAmount: 100, maximumAmount: 50000 });
const RETURN_URL = "https://app.example/credits";

/** The balance table the test application keeps, in the database the payment tables are in. */
async function createBalanceTable(knex) {
  await knex.schema.createTable("test_credits", (table) => {
    table.increments("id");
    table.string("reference", 200).notNullable();
    table.string("subject_id", 200).notNullable();
    table.integer("amount").notNullable();
    table.string("currency", 3).notNullable();
  });
}

/**
 * @param {import("knex").Knex} knex A database of the test's own, not yet migrated.
 * @param {Awaited<ReturnType<typeof import("./fakeStripe.js").startFakeStripe>>} stripe
 * @param {{ credit?: Function, appEnv?: string, topUps?: object | undefined }} [options] `credit` replaces the
 *   application's credit (it gets the default's arguments and the default itself); `topUps: undefined` composes none.
 */
export async function createTopUpApp(knex, stripe, { credit, appEnv = "test", ...options } = {}) {
  await migratePayments(knex);
  await createBalanceTable(knex);
  const store = await createTestPaymentStore(knex);
  const authorizations = [];
  const writeCredit = async ({ reference, subjectId, amount, currency }, txOptions) => {
    await txOptions.trx("test_credits").insert({ reference, subject_id: subjectId, amount, currency });
  };
  const adapter = createStripePaymentAdapter({
    apiKey: stripe.secretKey,
    appEnv,
    apiBaseUrl: stripe.url,
    webhookSecret: stripe.webhookSecret,
    environment: "sandbox",
    providerAccountId: stripe.accountId,
    priceBindings: {}
  });
  const merchantScope = { applicationId: "app", integrationId: "billing", providerAccountId: stripe.accountId, environment: "sandbox" };
  const service = createPaymentCheckoutService({
    appEnv,
    adapter,
    store,
    payments: {
      inspect: async () => ({ balance: 0, features: [], subscriptions: [] }),
      reconcileEvent: async () => {
        throw new Error("a top-up's event reached subscription handling");
      }
    },
    merchantScope,
    returnUrl: RETURN_URL,
    authorize: async (actor, request) => {
      authorizations.push(request);
      return actor === request.subjectId;
    },
    ...(Object.hasOwn(options, "topUps") ? { topUps: options.topUps } : {
      topUps: { offer: OFFER, credit: credit ? (request, txOptions) => credit(request, txOptions, writeCredit) : writeCredit }
    })
  });
  const session = (topUpId) => [...stripe.sessions.values()].find((each) => each.client_reference_id === topUpId);
  return {
    service,
    store,
    merchantScope,
    authorizations,
    /** The credit rows of a subject's balance, in the order they were written. */
    credits: async (subjectId) => (await knex("test_credits").where({ subject_id: subjectId }).orderBy("id"))
      .map(({ reference, amount, currency }) => ({ reference, amount, currency })),
    /** The session Stripe holds for a top-up. */
    session,
    /** Stripe's event about a top-up's session as it now stands, signed, as the webhook route passes it on. */
    event: (type, topUpId, changes = {}) => stripe.event(type, { ...session(topUpId), ...changes })
  };
}

export { OFFER, RETURN_URL };
