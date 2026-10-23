import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import createKnex from "knex";
import { hashPassword, verifyPassword } from "@jskit-ai/auth-provider-local-core/server/lib/index";
import { adoptOidcAccounts, exportLocalAccounts } from "../src/server/lib/localAccounts.js";

const execFileAsync = promisify(execFile);

async function fixtureApp(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "jskit-oidc-accounts-"));
  const knex = createKnex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(async () => {
    await knex.destroy();
    await rm(dir, { recursive: true, force: true });
  });
  // The columns auth-provider-local-db-core keeps for each local account.
  await knex.schema.createTable("auth_local_users", (table) => {
    table.string("id", 80).primary();
    table.string("email", 320).notNullable().unique();
    table.string("display_name", 160).notNullable();
    table.string("password_algorithm", 64).notNullable();
    table.string("password_version", 32).notNullable();
    table.string("password_salt", 256).notNullable();
    table.string("password_hash", 512).notNullable();
    table.boolean("disabled").notNullable().defaultTo(false);
    table.timestamp("created_at").notNullable();
    table.timestamp("updated_at").notNullable();
  });
  await knex.schema.createTable("users", (table) => {
    table.increments("id").primary();
    table.string("auth_provider").notNullable();
    table.string("auth_provider_user_sid").notNullable();
    table.string("email").notNullable();
    table.string("display_name").notNullable();
    table.unique(["auth_provider", "auth_provider_user_sid"]);
  });
  const now = new Date();
  const accounts = [
    { id: "usr_ada", email: "ada@example.test", name: "Ada", password: "correct horse battery", disabled: false },
    { id: "usr_bob", email: "bob@example.test", name: "Bob", password: "another long secret", disabled: true }
  ];
  for (const account of accounts) {
    const password = await hashPassword(account.password);
    await knex("auth_local_users").insert({
      id: account.id,
      email: account.email,
      display_name: `${account.name} (local)`,
      password_algorithm: password.algorithm,
      password_version: password.version,
      password_salt: password.salt,
      password_hash: password.hash,
      disabled: account.disabled,
      created_at: now,
      updated_at: now
    });
    await knex("users").insert({ auth_provider: "local", auth_provider_user_sid: account.id, email: account.email, display_name: account.name });
  }
  return { dir, knex, accounts };
}

test("export writes owner-only JSON Lines with unchanged scrypt fields and refuses to overwrite", async (t) => {
  const { dir, knex, accounts } = await fixtureApp(t);
  const out = path.join(dir, "accounts.jsonl");
  assert.deepEqual(await exportLocalAccounts({ knex, out }), { exported: 2 });
  assert.equal((await stat(out)).mode & 0o777, 0o600);
  const lines = (await readFile(out, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => [line.id, line.email, line.display_name, line.disabled]), [
    ["usr_ada", "ada@example.test", "Ada", false],
    ["usr_bob", "bob@example.test", "Bob", true]
  ]);
  const ada = lines[0];
  assert.deepEqual(Object.keys(ada).sort(), [
    "disabled", "display_name", "email", "id", "password_algorithm", "password_hash", "password_salt", "password_version"
  ]);
  const record = { algorithm: ada.password_algorithm, version: ada.password_version, salt: ada.password_salt, hash: ada.password_hash };
  assert.equal(await verifyPassword(accounts[0].password, record), true, "the exported hash still verifies");
  await assert.rejects(exportLocalAccounts({ knex, out }), /already exists/u);
});

test("adopt is a dry run until --apply and keeps every subject id", async (t) => {
  const { dir, knex } = await fixtureApp(t);
  const file = path.join(dir, "accounts.jsonl");
  await exportLocalAccounts({ knex, out: file });
  await writeFile(file, `${await readFile(file, "utf8")}${JSON.stringify({ id: "usr_gone" })}\n`);

  assert.deepEqual(await adoptOidcAccounts({ knex, file }), { adopt: 2, alreadyAdopted: 0, notFound: 1, conflicts: 0 });
  assert.deepEqual((await knex("users").pluck("auth_provider")), ["local", "local"], "dry run changes nothing");

  assert.deepEqual(await adoptOidcAccounts({ knex, file, apply: true }), { adopt: 2, alreadyAdopted: 0, notFound: 1, conflicts: 0 });
  assert.deepEqual(await knex("users").orderBy("id").select("auth_provider", "auth_provider_user_sid"), [
    { auth_provider: "oidc", auth_provider_user_sid: "usr_ada" },
    { auth_provider: "oidc", auth_provider_user_sid: "usr_bob" }
  ]);
  assert.deepEqual(await adoptOidcAccounts({ knex, file, apply: true }), { adopt: 0, alreadyAdopted: 2, notFound: 1, conflicts: 0 });
});

test("adopt leaves an account alone when the app already has an oidc row for it", async (t) => {
  const { dir, knex } = await fixtureApp(t);
  const file = path.join(dir, "accounts.jsonl");
  await exportLocalAccounts({ knex, out: file });
  await knex("users").insert({ auth_provider: "oidc", auth_provider_user_sid: "usr_ada", email: "ada+hub@example.test", display_name: "Ada" });
  assert.deepEqual(await adoptOidcAccounts({ knex, file, apply: true }), { adopt: 1, alreadyAdopted: 0, notFound: 0, conflicts: 1 });
  assert.equal((await knex("users").where({ auth_provider_user_sid: "usr_ada", auth_provider: "local" }).first()).email, "ada@example.test");
});

test("the command reads the app's knexfile and prints only counts", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "jskit-oidc-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const database = path.join(dir, "app.sqlite");
  await writeFile(path.join(dir, "knexfile.js"),
    `export default ${JSON.stringify({ client: "better-sqlite3", connection: { filename: database }, useNullAsDefault: true })};\n`);
  const knex = createKnex({ client: "better-sqlite3", connection: { filename: database }, useNullAsDefault: true });
  await knex.schema.createTable("auth_local_users", (table) => {
    for (const column of ["id", "email", "display_name", "password_algorithm", "password_version", "password_salt", "password_hash"]) table.string(column);
    table.boolean("disabled");
  });
  await knex.schema.createTable("users", (table) => {
    table.increments("id");
    for (const column of ["auth_provider", "auth_provider_user_sid", "email", "display_name"]) table.string(column);
  });
  const password = await hashPassword("correct horse battery");
  await knex("auth_local_users").insert({ id: "usr_ada", email: "ada@example.test", display_name: "Ada", disabled: false,
    password_algorithm: password.algorithm, password_version: password.version, password_salt: password.salt, password_hash: password.hash });
  await knex("users").insert({ auth_provider: "local", auth_provider_user_sid: "usr_ada", email: "ada@example.test", display_name: "Ada" });
  await knex.destroy();

  const bin = path.resolve(import.meta.dirname, "../bin/jskit-oidc-sign-in.js");
  const run = (...args) => execFileAsync(process.execPath, [bin, ...args], { cwd: dir, env: { PATH: process.env.PATH } });
  const exported = await run("export-local-accounts", "--out", "accounts.jsonl");
  assert.match(exported.stdout, /^Exported 1 accounts to accounts\.jsonl\./u);
  const dryRun = await run("adopt-oidc", "--issuer", "https://accounts.example.test", "--in", "accounts.jsonl");
  assert.equal(dryRun.stdout, "Would adopt 1 accounts, 0 already adopted, 0 not found, 0 conflicts.\n");
  const applied = await run("adopt-oidc", "--issuer", "https://accounts.example.test", "--in", "accounts.jsonl", "--apply");
  assert.equal(applied.stdout, "Adopted 1 accounts, 0 already adopted, 0 not found, 0 conflicts.\n");
  await assert.rejects(run("bogus"), (error) => error.code === 2 && /Usage/u.test(error.stderr));
});
