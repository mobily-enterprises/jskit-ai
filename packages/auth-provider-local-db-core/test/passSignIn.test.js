import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createLocalAuthService } from "../../auth-provider-local-core/src/server/lib/index.js";
import { localServiceOptions } from "../../auth-provider-local-core/test-support/localService.js";
import {
  createPassIssuer,
  exercisePassSignIn,
  passIdentityByEmail,
  passwordlessAccount
} from "../../auth-provider-local-core/test-support/passSignInScenario.js";
import { LOCAL_AUTH_DB_TABLES } from "../src/server/lib/index.js";
import { openSqliteLocalAuth } from "./support/localAuthRuntime.js";

const SERVER_SCRIPT = fileURLToPath(new URL("./support/passSignInServer.js", import.meta.url));
const runFile = promisify(execFile);

function startService(backend, issuer) {
  return createLocalAuthService({ ...localServiceOptions({ env: issuer.env }), backend, passIdentity: passIdentityByEmail(backend) });
}

test("a one-time pass signs its person in once, and every other pass is refused with its reason (database backend)", async (t) => {
  const issuer = createPassIssuer();
  const { backend, knex } = await openSqliteLocalAuth(t);
  await exercisePassSignIn(startService(backend, issuer), { backend, issuer });

  // The six passes used (two that signed in, three unmapped and the late one), by the hashes of their ids.
  const used = await knex(LOCAL_AUTH_DB_TABLES.passes).select("id");
  assert.equal(used.length, 6);
  assert.ok(used.every(({ id }) => /^[\w-]{43}$/u.test(id)));
});

test("used passes are deleted once they could no longer be used, so the table holds only the last minutes' passes", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-13T10:00:00.000Z") });
  const issuer = createPassIssuer();
  const { backend, knex } = await openSqliteLocalAuth(t);
  await backend.withTransaction((tx) => tx.users.create(passwordlessAccount({ id: "usr_ada", email: "ada@example.com", displayName: "Ada" })));
  const service = startService(backend, issuer);
  await service.signInWithPass({ pass: issuer.pass("ada@example.com") });
  await service.signInWithPass({ pass: issuer.pass("ada@example.com") });
  assert.equal((await knex(LOCAL_AUTH_DB_TABLES.passes).count({ count: "*" }))[0].count, 2);

  t.mock.timers.tick(90_000);
  await service.signInWithPass({ pass: issuer.pass("ada@example.com") });
  assert.equal((await knex(LOCAL_AUTH_DB_TABLES.passes).count({ count: "*" }))[0].count, 1);
});

/**
 * Signs in with the pass on a server in a process of its own, over the database file.
 * @param {string} filename
 * @param {string} pass
 * @param {Record<string, string>} env
 */
async function signInOnAnotherServer(filename, pass, env) {
  const { stdout } = await runFile(process.execPath, [SERVER_SCRIPT, filename, pass], {
    env: { ...process.env, ...env },
    timeout: 30_000
  });
  return JSON.parse(stdout);
}

test("a pass one server accepted is refused by another server on the same database, as replayed", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-pass-db-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "app.sqlite");
  const { backend, knex } = await openSqliteLocalAuth(t, { filename });
  await backend.withTransaction((tx) => tx.users.create(passwordlessAccount({ id: "usr_ada", email: "ada@example.com", displayName: "Ada" })));
  const issuer = createPassIssuer();
  const pass = issuer.pass("ada@example.com", { id: "pass-for-two-servers" });

  assert.deepEqual(await signInOnAnotherServer(filename, pass, issuer.env), { ok: true, userId: "usr_ada" });
  assert.deepEqual(await signInOnAnotherServer(filename, pass, issuer.env), { ok: false, status: 401, code: "auth.pass.replayed" });
  // This process is a third server on the database, and refuses it too.
  await assert.rejects(startService(backend, issuer).signInWithPass({ pass }), { status: 401, code: "auth.pass.replayed" });
  // The issuer's next pass signs in on the second server.
  assert.deepEqual(await signInOnAnotherServer(filename, issuer.pass("ada@example.com"), issuer.env), { ok: true, userId: "usr_ada" });

  const used = await knex(LOCAL_AUTH_DB_TABLES.passes).select("id");
  assert.equal(used.length, 2);
  assert.ok(used.every(({ id }) => id !== "pass-for-two-servers"));
});
