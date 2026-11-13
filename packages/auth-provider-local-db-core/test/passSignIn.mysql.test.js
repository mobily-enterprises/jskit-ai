import assert from "node:assert/strict";
import test from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { createLocalAuthService } from "../../auth-provider-local-core/src/server/lib/index.js";
import { localServiceOptions } from "../../auth-provider-local-core/test-support/localService.js";
import { createPassIssuer, passIdentityByEmail, passwordlessAccount } from "../../auth-provider-local-core/test-support/passSignInScenario.js";
import { openLocalAuthDatabase } from "./support/mysqlLocalAuth.js";

const usePass = (tx) => tx.passes.use({ id: "hash-of-one-pass", expiresAt: "2026-11-13T10:01:30.000Z" });

test("two first uses of one pass at once, as two servers make them, record it once and only one is first", async (context) => {
  requireTestDatabase(process.env);
  const { backend, knex } = await openLocalAuthDatabase(context, "da_local_pass_race");
  const snapshotTaken = Promise.withResolvers();
  const otherCommitted = Promise.withResolvers();
  let attempts = 0;
  // A reads first, so its snapshot is older than B's row; then B records the pass and commits; then A looks for the
  // pass, does not see B's row, and records it too. A's insert meets B's row, its transaction rolls back, and it runs
  // again, seeing the row: A is not first.
  const useA = backend.withTransaction(async (tx) => {
    attempts += 1;
    if (attempts === 1) {
      await tx.users.findById("usr_nobody");
      snapshotTaken.resolve();
      await otherCommitted.promise;
    }
    return usePass(tx);
  });
  await snapshotTaken.promise;
  assert.equal(await backend.withTransaction(usePass), true);
  otherCommitted.resolve();

  assert.equal(await useA, false);
  assert.equal(attempts, 2);
  assert.equal((await knex("auth_local_used_passes").where({ id: "hash-of-one-pass" })).length, 1);
});

test("of one pass posted to two servers at the same moment, one signs in and the other is refused as replayed", async (context) => {
  requireTestDatabase(process.env);
  const { backend } = await openLocalAuthDatabase(context, "da_local_pass_twice");
  const issuer = createPassIssuer();
  await backend.withTransaction((tx) => tx.users.create(passwordlessAccount({ id: "usr_ada", email: "ada@example.com", displayName: "Ada" })));
  // Each service has its own connections from the pool, as two servers do.
  const servers = [0, 1].map(() =>
    createLocalAuthService({ ...localServiceOptions({ env: issuer.env }), backend, passIdentity: passIdentityByEmail(backend) }));

  for (let round = 0; round < 10; round += 1) {
    const pass = issuer.pass("ada@example.com");
    const outcomes = await Promise.allSettled(servers.map((server) => server.signInWithPass({ pass })));
    assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
    const [refusal] = outcomes.filter(({ status }) => status === "rejected");
    assert.equal(refusal.reason.code, "auth.pass.replayed");
  }
});
