import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import migration from "../migrations/console_core_generic_initial.cjs";
import { createRepository } from "../src/server/consoleSettings/consoleSettingsRepository.js";
import { consoleSettingsTableResource } from "../src/shared/resources/consoleSettingsTableResource.js";
import { createConsoleRuntime } from "../src/server/consoleRuntime.js";

// The console settings record on MariaDB, through the repository (the console.settings capability) and the console
// runtime's services built on it, pinned before the repository moves onto a table resource: the singleton's shape, the
// first owner winning, its refusals and errors, and joining a caller's transaction.

// The runtime's own MySQL connection settings (database-runtime's resolveKnexConnectionFromEnvironment).
const RUNTIME_MYSQL = Object.freeze({ supportBigNumbers: true, bigNumberStrings: true, dateStrings: ["DATE"], timezone: "Z" });
const ISO_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u;
const LONG_AGO = "2001-02-03T04:05:06.000Z";

/** A migrated database of the test's own, beside TEST_DB_NAME, dropped after the test. */
async function ownDatabase(context, suffix) {
  const name = `${requireTestDatabase(process.env)}_${suffix}`;
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD };
  const admin = knexLib({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
  await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
  await admin.raw("CREATE DATABASE ??", [name]);
  const knex = knexLib({ client: "mysql2", connection: { ...server, database: name, ...RUNTIME_MYSQL }, pool: { min: 0, max: 4 } });
  context.after(async () => {
    await knex.destroy();
    await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
    await admin.destroy();
  });
  await migration.up(knex);
  // Seeded long ago, so the repository's own updates of updated_at show.
  await knex("console_settings").where({ id: 1 }).update({ updated_at: "2001-02-03 04:05:06" });
  return knex;
}

/** The repository on the console feature's handle of the record, over the test's database. */
async function repositoryOn(knex) {
  const runtime = await createTestResourceRuntime({ knex });
  const { consoleSettings } = await runtime.own("console.core", [consoleSettingsTableResource]);
  return createRepository({ consoleSettings });
}

/** The current second, as the second-precision timestamps keep it. */
const thisSecond = () => Math.floor(Date.now() / 1000) * 1000;

test("the singleton answers its id, owner, empty settings and ISO timestamps", async (context) => {
  requireTestDatabase(process.env);
  const repository = await repositoryOn(await ownDatabase(context, "da_console_shape"));
  assert.ok(Object.isFrozen(repository));
  assert.deepEqual(Object.keys(repository), ["withTransaction", "getSingleton", "ensureOwnerUserId", "updateSingleton"]);

  const singleton = await repository.getSingleton();
  assert.deepEqual(Object.keys(singleton), ["id", "ownerUserId", "settings", "createdAt", "updatedAt"]);
  assert.equal(singleton.id, "1");
  assert.equal(singleton.ownerUserId, null);
  assert.deepEqual(singleton.settings, {});
  assert.match(singleton.createdAt, ISO_SECONDS);
  assert.equal(singleton.updatedAt, LONG_AGO);
  assert.notEqual((await repository.getSingleton()).settings, singleton.settings, "each read answers new settings");

  const before = thisSecond();
  const updated = await repository.updateSingleton();
  assert.deepEqual(Object.keys(updated), ["id", "ownerUserId", "settings", "createdAt", "updatedAt"]);
  assert.deepEqual({ ...updated, updatedAt: "" }, { ...singleton, updatedAt: "" }, "an update only touches updated_at");
  assert.match(updated.updatedAt, ISO_SECONDS);
  // A server that rounds fractional seconds, rather than cut them, may store the next second.
  assert.ok(Date.parse(updated.updatedAt) >= before && Date.parse(updated.updatedAt) <= Date.now() + 1000, updated.updatedAt);
  assert.deepEqual(await repository.getSingleton(), updated);
});

test("the first owner wins, the same answer comes back after, and anything but a positive id is refused", async (context) => {
  requireTestDatabase(process.env);
  const repository = await repositoryOn(await ownDatabase(context, "da_console_owner"));

  for (const userId of [0, -1, 1.5, "abc", "007", "", null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(repository.ensureOwnerUserId(userId), {
      name: "TypeError",
      message: "consoleSettingsRepository.ensureOwnerUserId requires a positive user id."
    }, String(userId));
  }
  assert.equal((await repository.getSingleton()).ownerUserId, null);
  assert.equal((await repository.getSingleton()).updatedAt, LONG_AGO, "a refused id writes nothing");

  const before = thisSecond();
  assert.equal(await repository.ensureOwnerUserId(7), "7", "the id comes back as text");
  const owned = await repository.getSingleton();
  assert.equal(owned.ownerUserId, "7");
  assert.ok(Date.parse(owned.updatedAt) >= before, "setting the owner touches updated_at");

  assert.equal(await repository.ensureOwnerUserId(9), "7", "a later user gets the first owner back");
  assert.equal(await repository.ensureOwnerUserId("7"), "7");
  assert.equal(await repository.ensureOwnerUserId(" 7 "), "7");
  assert.deepEqual(await repository.getSingleton(), owned, "and nothing changes");
});

test("two first owners at once both get the same winner", async (context) => {
  requireTestDatabase(process.env);
  const repository = await repositoryOn(await ownDatabase(context, "da_console_race"));
  const answers = await Promise.all([repository.ensureOwnerUserId(3), repository.ensureOwnerUserId(4)]);
  assert.equal(answers[0], answers[1]);
  assert.ok(["3", "4"].includes(answers[0]));
  assert.equal((await repository.getSingleton()).ownerUserId, answers[0]);
});

test("the repository joins its caller's transaction: a rollback undoes the owner and the touch", async (context) => {
  requireTestDatabase(process.env);
  const repository = await repositoryOn(await ownDatabase(context, "da_console_trx"));

  const failure = new Error("rolled back");
  await assert.rejects(repository.withTransaction({}, async (txOptions) => {
    assert.equal(await repository.ensureOwnerUserId(" 5 ", txOptions), "5");
    assert.equal((await repository.getSingleton(txOptions)).ownerUserId, "5", "seen inside the transaction");
    assert.equal((await repository.getSingleton()).ownerUserId, null, "not outside it before the commit");
    assert.notEqual((await repository.updateSingleton(txOptions)).updatedAt, LONG_AGO);
    throw failure;
  }), (error) => error === failure);
  const after = await repository.getSingleton();
  assert.equal(after.ownerUserId, null);
  assert.equal(after.updatedAt, LONG_AGO);

  assert.equal(await repository.withTransaction({}, async (txOptions) => repository.ensureOwnerUserId(6, txOptions)), "6", "withTransaction answers the work's value");
  assert.equal((await repository.getSingleton({ trx: null })).ownerUserId, "6", "kept once committed; a null trx reads outside one");
});

test("without its row, every call fails with the same plain error", async (context) => {
  requireTestDatabase(process.env);
  const knex = await ownDatabase(context, "da_console_missing");
  const repository = await repositoryOn(knex);
  await knex("console_settings").where({ id: 1 }).del();
  const missing = (error) => {
    assert.equal(error.constructor, Error);
    assert.equal(error.message, "console_settings singleton row is missing.");
    assert.equal(error.code, undefined);
    return true;
  };
  await assert.rejects(repository.getSingleton(), missing);
  await assert.rejects(repository.ensureOwnerUserId(1), missing);
  await assert.rejects(repository.updateSingleton(), missing);
  assert.equal(await knex("console_settings").count({ rows: "*" }).first().then((row) => Number(row.rows)), 0, "nothing creates the row again");
});

test("the console runtime's services make the first signed-in user the owner and refuse everyone else", async (context) => {
  requireTestDatabase(process.env);
  const repository = await repositoryOn(await ownDatabase(context, "da_console_runtime"));
  const { services } = createConsoleRuntime({ consoleSettingsRepository: repository });
  const refused = (status, code, message) => (error) => {
    assert.equal(error.name, "AppError");
    assert.equal(error.status, status);
    assert.equal(error.statusCode, status);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    return true;
  };

  assert.equal(await services.access.isConsoleOwnerUserId(7), false, "no owner yet");
  await assert.rejects(services.settings.getSettings({ context: {} }), refused(401, "console.owner.authenticationRequired", "Authentication required."));
  assert.equal((await repository.getSingleton()).ownerUserId, null);
  await assert.rejects(services.access.ensureInitialConsoleMember("someone"), refused(400, "console.owner.invalidUser", "Invalid console user."));

  const before = thisSecond();
  assert.deepEqual((await services.settings.getSettings({ context: { actor: { id: 7 } } })).value, { settings: {} });
  assert.equal((await repository.getSingleton()).ownerUserId, "7", "the first signed-in user became the owner");
  assert.equal(await services.access.isConsoleOwnerUserId("7"), true);
  assert.equal(await services.access.isConsoleOwnerUserId(8), false);
  assert.equal(await services.access.isConsoleOwnerUserId("not-an-id"), false);

  await assert.rejects(services.settings.updateSettings({ context: { actor: { id: 8 } } }), refused(403, "console.owner.forbidden", "Forbidden."));
  assert.equal((await repository.getSingleton()).ownerUserId, "7");
  // The request's user counts when the context has no actor.
  assert.deepEqual((await services.settings.updateSettings({ context: { requestMeta: { request: { user: { id: "7" } } } } })).value, { settings: {} });
  assert.ok(Date.parse((await repository.getSingleton()).updatedAt) >= before, "an update touches the record");
  assert.equal(await services.access.ensureInitialConsoleMember(9), "7");
});
