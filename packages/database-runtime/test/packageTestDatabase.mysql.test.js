import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import knexFactory from "knex";
import { createKnexMigrationConfig } from "../src/server/knexMigrationConfig.js";
import { RUN_SETTINGS_FILE, createPackageTestKnex, requireTestDatabase, testDatabaseRun } from "../src/server/testDatabases.js";

// createPackageTestKnex() on MariaDB and MySQL for a database user granted only its test database and that database's
// copies, each by name with every _ escaped, as a managed host may grant them: a package test claims one of the 26 lettered
// copies, never a name of its own. Each test claims the copies of a database of its own named after TEST_DB_NAME, so
// it never meets another file's. The run's DB_USER makes the users: it needs CREATE USER, and GRANT OPTION on the
// databases named after TEST_DB_NAME. A `jskit test --databases` run for a user granted only some numbered copies runs
// as many files at once as it may make databases, and says which copy it may not create.

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

test("a jskit test --databases run whose database user may create only some numbered copies runs that many files at once, and names the copy it may not create", async (context) => {
  const base = `${requireTestDatabase(process.env)}_c7`;
  const granted = await userGrantedOnly(context, base, ["0", "1"]);
  const environment = { ...granted, DB_NAME: `${base}_application` };
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-granted-"));
  const admin = knexFactory({ client: "mysql2", connection: serverConnection(), pool: { min: 0, max: 1 } });
  context.after(async () => {
    try {
      for (const database of [base, `${base}_0`, `${base}_1`, `${base}_2`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    } finally {
      await admin.destroy();
      await rm(appRoot, { recursive: true, force: true });
    }
  });
  await mkdir(path.join(appRoot, "migrations"));
  await writeFile(path.join(appRoot, "migrations", "20200101000000_notes.cjs"),
    "exports.up = (knex) => knex.schema.createTable(\"notes\", (table) => table.increments());\nexports.down = () => {};\n");
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment, appRoot });
  const run = await testDatabaseRun({ knexConfig, environment, count: 3, appRoot });
  try {
    assert.equal(run.concurrency, 2);
    assert.equal(run.asked, 3);
    assert.equal(run.shortfall, `the database user may not create ${base}_2`);
    assert.match(run.summary, new RegExp(`^2 of 3 test database\\(s\\) from ${base} ready in \\d+ms: `, "u"));
    assert.ok(run.summary.endsWith(`; the database user may not create ${base}_2`), run.summary);
  } finally {
    assert.equal(await run.cleanup(), "dropped the run's 1 numbered test database(s)");
  }
});

test("a jskit test --databases run whose database user may not create TEST_DB_NAME_0, the snapshot database, runs one file at a time and names the grant", async (context) => {
  const base = `${requireTestDatabase(process.env)}_c9`;
  const granted = await userGrantedOnly(context, base, ["1"]);
  const environment = { ...granted, DB_NAME: `${base}_application` };
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-no-snapshot-"));
  const admin = knexFactory({ client: "mysql2", connection: serverConnection(), pool: { min: 0, max: 1 } });
  context.after(async () => {
    try {
      for (const database of [base, `${base}_0`, `${base}_1`]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    } finally {
      await admin.destroy();
      await rm(appRoot, { recursive: true, force: true });
    }
  });
  await mkdir(path.join(appRoot, "migrations"));
  await writeFile(path.join(appRoot, "migrations", "20200101000000_notes.cjs"),
    "exports.up = (knex) => knex.schema.createTable(\"notes\", (table) => table.increments());\nexports.down = () => {};\n");
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment, appRoot });
  const run = await testDatabaseRun({ knexConfig, environment, count: 2, appRoot });
  assert.equal(run.concurrency, 1);
  assert.equal(run.shortfall, `the database user may not prepare ${base}: it may not create ${base}_0, the database that holds ` +
    `the run's snapshot; grant it all privileges on ${base}_0 by name, as on ${base} and its copies`);
});

// The contract a managed host grants by (Vibe64 Online grants exactly these names, and checks them by replaying what
// JSKIT does): a run of N files at once needs TEST_DB_NAME, its snapshot database _0 and its copies _1 to _(N-1), and its
// package tests the lettered copies, each granted by name, with no grant on a prefix.
test("a jskit test --databases run of 16 files at once on MySQL or MariaDB needs exactly TEST_DB_NAME, its snapshot database _0, its copies _1 to _15 and the lettered copies, each granted by name", async (context) => {
  const base = `${requireTestDatabase(process.env)}_c8`;
  const numbered = Array.from({ length: 15 }, (_, index) => `${base}_${index + 1}`);
  const granted = await userGrantedOnly(context, base, ["0", ...numbered.map((name) => name.slice(base.length + 1)), ...LETTERS]);
  const environment = { ...granted, DB_NAME: `${base}_application` };
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-test-databases-sixteen-"));
  const admin = knexFactory({ client: "mysql2", connection: serverConnection(), pool: { min: 0, max: 1 } });
  context.after(async () => {
    try {
      for (const database of [base, `${base}_0`, ...numbered]) await admin.raw("DROP DATABASE IF EXISTS ??", [database]);
    } finally {
      await admin.destroy();
      await rm(appRoot, { recursive: true, force: true });
    }
  });
  await mkdir(path.join(appRoot, "migrations"));
  await writeFile(path.join(appRoot, "migrations", "20200101000000_notes.cjs"),
    "exports.up = (knex) => knex.schema.createTable(\"notes\", (table) => table.increments());\nexports.down = () => {};\n");
  const knexConfig = createKnexMigrationConfig({ client: "mysql2", environment, appRoot });
  const run = await testDatabaseRun({ knexConfig, environment, count: 16, appRoot });
  try {
    assert.deepEqual([run.concurrency, run.shortfall], [16, ""]);
    const settings = JSON.parse(await readFile(path.join(run.env.JSKIT_TEST_DATABASES, RUN_SETTINGS_FILE), "utf8"));
    assert.deepEqual(settings.databases, [base, ...numbered]);
    await context.test("a package test in the run's sixteenth file", async (t) => {
      const db = await createPackageTestKnex(t, { environment: { ...environment, DB_NAME: numbered[14], TEST_DB_NAME: numbered[14],
        JSKIT_DESIGNATED_TEST_DB_NAME: base } });
      assert.equal((await databaseOf(db)).name, `${base}_a`);
    });
  } finally {
    assert.equal(await run.cleanup(), "dropped the run's 15 numbered test database(s)");
  }
});
