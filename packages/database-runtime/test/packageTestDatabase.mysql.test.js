import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import knexFactory from "knex";
import { createPackageTestKnex, requireTestDatabase } from "../src/server/testDatabases.js";

// createPackageTestKnex() on MariaDB and MySQL for a database user granted only its test database and that database's
// copies, each by name with every _ escaped, as a managed host may grant them: a package test claims one of the 26 lettered
// copies, never a name of its own. Each test claims the copies of a database of its own named after TEST_DB_NAME, so
// it never meets another file's. The run's DB_USER makes the users: it needs CREATE USER, and GRANT OPTION on the
// databases named after TEST_DB_NAME.

const LETTERS = [..."abcdefghijklmnopqrstuvwxyz"];
const NUMBERED = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

function serverConnection(overrides = {}) {
  return { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, ...overrides };
}

/** The grant names a refusal gives for `base`'s lettered copies. */
function grantHint(base) {
  return `A package data test on MySQL or MariaDB claims only TEST_DB_NAME's 26 lettered copies, ${base}_a to ${base}_z: ` +
    `grant DB_USER all privileges on each by name, or on all at once as \`${base.replace(/_/gu, "\\_")}\\__\`.*.`;
}

/**
 * A session that keeps what it locks until it ends, after the test: `raw` answers Knex's raw result, `rows` its rows.
 * @param {import("node:test").TestContext} context
 * @param {object} [connection]
 */
async function heldSession(context, connection = serverConnection()) {
  const knex = knexFactory({ client: "mysql2", connection, pool: { min: 0, max: 1 } });
  const held = await knex.client.acquireConnection();
  let ended = false;
  const end = async () => {
    if (ended) return;
    ended = true;
    await knex.client.releaseConnection(held);
    await knex.destroy();
  };
  context.after(end);
  const raw = (sql, bindings = []) => knex.raw(sql, bindings).connection(held);
  return { raw, rows: async (sql, bindings) => (await raw(sql, bindings))[0], end };
}

/**
 * A database user granted only `base` and its copies with the given suffixes, and the environment its package tests
 * run with on `base`; after the test the user is dropped, with every lettered copy of `base`.
 * @param {import("node:test").TestContext} context
 * @param {string} base
 * @param {string[]} suffixes
 */
async function userGrantedOnly(context, base, suffixes) {
  const admin = knexFactory({ client: "mysql2", connection: serverConnection(), pool: { min: 0, max: 1 } });
  const [[{ who }]] = await admin.raw("SELECT CURRENT_USER() AS who");
  const host = who.slice(who.lastIndexOf("@") + 1);
  const user = `jskit_claim_${randomBytes(4).toString("hex")}`;
  const password = randomBytes(12).toString("hex");
  context.after(async () => {
    try {
      await admin.raw("DROP USER IF EXISTS ?@?", [user, host]);
      for (const letter of LETTERS) await admin.raw("DROP DATABASE IF EXISTS ??", [`${base}_${letter}`]);
    } finally {
      await admin.destroy();
    }
  });
  try {
    await admin.raw("CREATE USER ?@? IDENTIFIED BY ?", [user, host, password]);
    for (const database of [base, ...suffixes.map((suffix) => `${base}_${suffix}`)]) {
      await admin.raw("GRANT ALL PRIVILEGES ON ??.* TO ?@?", [database.replace(/_/gu, "\\_"), user, host]);
    }
  } catch (error) {
    throw new Error("These tests need DB_USER to make a database user and grant it databases named after TEST_DB_NAME: " +
      "CREATE USER, and GRANT OPTION on `<TEST_DB_NAME>\\_%`.*.", { cause: error });
  }
  return { ...process.env, DB_CLIENT: "mysql2", DATABASE_URL: "", DB_USER: user, DB_PASSWORD: password, DB_NAME: base,
    TEST_DB_NAME: base, JSKIT_DESIGNATED_TEST_DB_NAME: "" };
}

async function databaseOf(db) {
  const [[database]] = await db.raw("SELECT DATABASE() AS name, @@character_set_database AS charset, @@collation_database AS collation");
  const tables = await db("information_schema.TABLES").where("TABLE_SCHEMA", database.name).pluck("TABLE_NAME");
  return { ...database, tables };
}

async function lockIsFree(session, name) {
  return Number((await session.rows("SELECT IS_FREE_LOCK(?) AS free", [name]))[0].free) === 1;
}

async function exists(session, database) {
  return (await session.rows("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [database])).length > 0;
}

test("package tests at once each claim a lettered copy no other session holds, recreated empty, dropped and given up after the test", async (context) => {
  const base = `${requireTestDatabase(process.env)}_c1`;
  const environment = await userGrantedOnly(context, base, [...NUMBERED, ...LETTERS]);
  const holder = await heldSession(context);
  // An interrupted test left a table in the first copy, and another tree's test holds the second.
  await holder.raw("CREATE DATABASE ?? CHARACTER SET utf8mb4", [`${base}_a`]);
  await holder.raw("CREATE TABLE ??.left_behind (id INT)", [`${base}_a`]);
  assert.equal(Number((await holder.rows("SELECT GET_LOCK(?, 0) AS held", [`${base}_b`]))[0].held), 1);
  const claimed = [];
  await context.test("three package tests' Knexes at once", async (t) => {
    const knexes = await Promise.all([0, 1, 2].map(() => createPackageTestKnex(t, { environment })));
    for (const [index, db] of knexes.entries()) {
      const { name, charset, collation, tables } = await databaseOf(db);
      assert.deepEqual([charset, collation, tables], ["utf8mb4", "utf8mb4_unicode_ci", []]);
      claimed.push(name);
      await db.schema.createTable("notes", (table) => { table.increments("id"); table.string("title"); });
      await db("notes").insert({ title: `note ${index}` });
    }
    assert.deepEqual([...claimed].sort(), [`${base}_a`, `${base}_c`, `${base}_d`]);
    for (const database of claimed) assert.equal(await lockIsFree(holder, database), false, `${database} is claimed`);
    assert.deepEqual(await Promise.all(knexes.map((db) => db("notes").pluck("title"))), [["note 0"], ["note 1"], ["note 2"]]);
  });
  for (const database of claimed) {
    assert.equal(await exists(holder, database), false, `${database} was dropped after its test`);
    assert.equal(await lockIsFree(holder, database), true, `${database} was given up after its test`);
  }
  assert.equal(await lockIsFree(holder, `${base}_b`), false);
});

test("in a file jskit test --databases gave a numbered copy, a package test claims the run's designated database's lettered copies", async (context) => {
  const base = `${requireTestDatabase(process.env)}_c2`;
  const environment = await userGrantedOnly(context, base, [...NUMBERED, ...LETTERS]);
  await context.test("a package test in the file", async (t) => {
    const db = await createPackageTestKnex(t, { environment: { ...environment, DB_NAME: `${base}_3`, TEST_DB_NAME: `${base}_3`,
      JSKIT_DESIGNATED_TEST_DB_NAME: base } });
    assert.equal((await databaseOf(db)).name, `${base}_a`);
  });
});

test("a database user not granted the lettered copies is refused before any is made, told the 26 names and their grant", async (context) => {
  const base = `${requireTestDatabase(process.env)}_c3`;
  // A host that grants only the numbered copies, which a jskit test --databases run needs.
  const environment = await userGrantedOnly(context, base, NUMBERED);
  await assert.rejects(createPackageTestKnex(context, { environment }), { message: `DB_USER may not create ${base}_a. ${grantHint(base)}` });
  const holder = await heldSession(context);
  assert.deepEqual(await holder.rows("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?",
    [`${base.replace(/_/gu, "\\_")}\\_%`]), []);
  assert.equal(await lockIsFree(holder, `${base}_a`), true);
});

test("with every lettered copy held, a claim waits for one to come free, and refuses past its time, told the 26 names and their grant", async (context) => {
  const base = `${requireTestDatabase(process.env)}_c4`;
  const environment = await userGrantedOnly(context, base, [...NUMBERED, ...LETTERS]);
  const holder = await heldSession(context);
  for (const letter of LETTERS) assert.equal(Number((await holder.rows("SELECT GET_LOCK(?, 0) AS held", [`${base}_${letter}`]))[0].held), 1);
  await context.test("a claim waits for the copy another test gives up", async (t) => {
    const claim = createPackageTestKnex(t, { environment });
    await delay(600);
    await holder.raw("SELECT RELEASE_LOCK(?)", [`${base}_q`]);
    assert.equal((await databaseOf(await claim)).name, `${base}_q`);
  });
  assert.equal(Number((await holder.rows("SELECT GET_LOCK(?, 0) AS held", [`${base}_q`]))[0].held), 1);
  const { claimLetteredCopy } = await import("../src/server/mysqlPackageTestDatabase.js");
  const claimant = await heldSession(context, serverConnection({ user: environment.DB_USER, password: environment.DB_PASSWORD }));
  await assert.rejects(claimLetteredCopy(claimant.raw, base, { timeoutMs: 300 }), { message: `All 26 lettered copies of ${base} ` +
    `DB_USER may create (${base}_a to ${base}_z) are held by other tests, and none came free within 0.3s: let some finish, ` +
    `or run fewer at once. ${grantHint(base)}` });
});

test("a database user granted only some lettered copies waits for those, and past its time is told the 26 names and their grant", async (context) => {
  const base = `${requireTestDatabase(process.env)}_c5`;
  const environment = await userGrantedOnly(context, base, [...NUMBERED, "a", "b", "c"]);
  const holder = await heldSession(context);
  for (const letter of ["a", "b", "c"]) await holder.raw("SELECT GET_LOCK(?, 0)", [`${base}_${letter}`]);
  const { claimLetteredCopy } = await import("../src/server/mysqlPackageTestDatabase.js");
  const claimant = await heldSession(context, serverConnection({ user: environment.DB_USER, password: environment.DB_PASSWORD }));
  await assert.rejects(claimLetteredCopy(claimant.raw, base, { timeoutMs: 300 }), { message: `All 3 lettered copies of ${base} ` +
    `DB_USER may create (${base}_a to ${base}_c) are held by other tests, and none came free within 0.3s: let some finish, ` +
    `or run fewer at once. ${grantHint(base)}` });
  assert.equal(await lockIsFree(holder, `${base}_d`), true, "the refused copy's lock was given back");
});

// Claims a copy, writes a table into it, prints its name and waits to be killed.
const CLAIMING_CHILD = (moduleUrl) => `import { createPackageTestKnex } from ${JSON.stringify(moduleUrl)};
const db = await createPackageTestKnex({ after() {} }, { environment: process.env });
await db.schema.createTable("left_behind", (table) => table.increments("id"));
const [[{ name }]] = await db.raw("SELECT DATABASE() AS name");
process.stdout.write(name + "\\n");
setInterval(() => {}, 60000);
`;

test("a test whose process dies gives its copy up with its session, and the next claim gets it back empty", async (context) => {
  const base = `${requireTestDatabase(process.env)}_c6`;
  const environment = await userGrantedOnly(context, base, [...NUMBERED, ...LETTERS]);
  const childEnvironment = { ...environment };
  delete childEnvironment.NODE_TEST_CONTEXT;
  const moduleUrl = new URL("../src/server/testDatabases.js", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", CLAIMING_CHILD(moduleUrl)],
    { env: childEnvironment, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  context.after(() => child.kill("SIGKILL"));
  let output = "";
  let errors = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const deadline = Date.now() + 30_000;
  while (!output.includes("\n") && child.exitCode === null && Date.now() < deadline) await delay(20);
  assert.equal(output.trim(), `${base}_a`, errors.slice(0, 2000));
  const holder = await heldSession(context);
  assert.equal(await lockIsFree(holder, `${base}_a`), false);
  child.kill("SIGKILL");
  await exited;
  // The server ends the dead process's session, and its claim with it.
  const freed = Date.now() + 10_000;
  while (!(await lockIsFree(holder, `${base}_a`)) && Date.now() < freed) await delay(50);
  await context.test("the next package test", async (t) => {
    const { name, tables } = await databaseOf(await createPackageTestKnex(t, { environment }));
    assert.deepEqual([name, tables], [`${base}_a`, []]);
  });
});
