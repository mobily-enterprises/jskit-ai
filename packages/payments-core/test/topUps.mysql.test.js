import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { startFakeStripe } from "./support/fakeStripe.js";
import { createTopUpApp } from "./support/topUpApp.js";

// The two doors that settle a top-up, its verified webhook and its return page's confirmation, racing over one
// payment on MariaDB, where their transactions truly run at once: the top-up is credited once. Once-only lives in the
// top-up's row: each door moves its status to paid under that row's lock, in the transaction that writes the credit,
// so the door that waits for the lock finds it paid.

// The runtime's own MySQL connection settings (database-runtime's resolveKnexConnectionFromEnvironment).
const RUNTIME_MYSQL = Object.freeze({ supportBigNumbers: true, bigNumberStrings: true, dateStrings: ["DATE"], timezone: "Z" });

/** A database of the test's own, beside TEST_DB_NAME, dropped after the test. */
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
  return knex;
}

/** A promise the test resolves itself. */
function gate() {
  let open;
  const opened = new Promise((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

test("the webhook and the return page settling one payment at the same moment credit it once", async (context) => {
  requireTestDatabase(process.env);
  const knex = await ownDatabase(context, "pay_top_up_race");
  const stripe = await startFakeStripe();
  context.after(() => stripe.close());
  // The first door to credit stops inside its transaction, holding the top-up's row, until the other door has read it.
  let hold = null;
  const app = await createTopUpApp(knex, stripe, {
    credit: async (request, txOptions, write) => {
      await write(request, txOptions);
      const held = hold;
      hold = null;
      if (held) {
        held.entered.open();
        await held.release.opened;
      }
    }
  });
  // The other door's read of the top-up in its settling transaction (its lock), sent while the first door holds the
  // row; the return page reads Stripe's session first.
  let watching = null;
  knex.on("query", ({ sql, __knexTxId }) => {
    if (watching && __knexTxId && /payment_top_ups/u.test(sql) && watching.ready()) {
      watching.reached.open();
      watching = null;
    }
  });
  const doors = (topUpId) => ({
    webhook: () => app.service.webhook(app.event("checkout.session.completed", topUpId)),
    return: () => app.service.confirmTopUp({ actor: "tenant-a", subjectId: "tenant-a", topUpId })
  });

  for (const [first, second] of [["webhook", "return"], ["return", "webhook"]]) {
    const { topUpId } = await app.service.topUp({ actor: "tenant-a", subjectId: "tenant-a", amount: 500, requestId: `race-${first}` });
    stripe.pay(app.session(topUpId).id);
    hold = { entered: gate(), release: gate() };
    const { entered, release } = hold;
    const opening = doors(topUpId)[first]();
    await entered.opened;
    const reached = gate();
    const before = stripe.requests.length;
    const readStripe = () => stripe.requests.slice(before).some(({ method, path }) => method === "GET" && path.startsWith("/v1/checkout/sessions/"));
    watching = { reached, ready: second === "return" ? readStripe : () => true };
    const closing = doors(topUpId)[second]();
    await reached.opened;
    release.open();
    const results = await Promise.all([opening, closing]);
    assert.deepEqual(results.map(({ status, credited }) => [status, credited]), [["paid", true], ["paid", false]], `${first} first`);
  }
  assert.deepEqual((await app.credits("tenant-a")).map(({ amount }) => amount), [500, 500], "each top-up credited once");

  // And with no hand on the timing: every door at once, for several top-ups.
  const started = [];
  for (let index = 0; index < 8; index += 1) {
    const { topUpId } = await app.service.topUp({ actor: "tenant-a", subjectId: "tenant-a", amount: 100 + index, requestId: `crowd-${index}` });
    stripe.pay(app.session(topUpId).id);
    started.push(topUpId);
  }
  const results = await Promise.all(started.flatMap((topUpId) => [doors(topUpId).webhook(), doors(topUpId).return(), doors(topUpId).webhook()]));
  assert.equal(results.filter(({ credited }) => credited).length, 8);
  const credits = await app.credits("tenant-a");
  assert.equal(credits.length, 10);
  assert.equal(new Set(credits.map(({ reference }) => reference)).size, 10, "no top-up credited twice");
});
