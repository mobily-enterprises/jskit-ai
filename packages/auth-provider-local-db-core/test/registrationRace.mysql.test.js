import assert from "node:assert/strict";
import test from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { openLocalAuthDatabase } from "./support/mysqlLocalAuth.js";

const PASSWORD = Object.freeze({ algorithm: "scrypt", version: "1", salt: "salt-one", hash: "hash-one" });
const registration = (tokenHash) => ({
  email: "race@example.com",
  displayName: "Ada",
  password: PASSWORD,
  tokenHash,
  createdAt: "2026-11-01T08:00:00.000Z",
  expiresAt: "2026-11-09T00:00:00.000Z"
});

test("two first registrations of one email at once both land, and the later one stays", async (context) => {
  requireTestDatabase(process.env);
  const { backend, knex } = await openLocalAuthDatabase(context, "da_local_registration_race");
  const firstRead = Promise.withResolvers();
  const otherCommitted = Promise.withResolvers();
  let attempts = 0;
  // A reads no registration, then B registers the same email and commits, then A saves: A's upsert meets a row
  // another transaction committed after A's read, and must still create or replace it rather than refuse it.
  const registrationA = backend.withTransaction(async (tx) => {
    attempts += 1;
    const found = await tx.registrations.findByEmail("race@example.com");
    if (attempts === 1) {
      assert.equal(found, null);
      firstRead.resolve();
      await otherCommitted.promise;
    }
    return tx.registrations.save(registration("token-a"));
  });
  await firstRead.promise;
  await backend.withTransaction((tx) => tx.registrations.save(registration("token-b")));
  otherCommitted.resolve();

  const saved = await registrationA;
  assert.equal(saved.tokenHash, "token-a");
  const rows = await knex("auth_local_registrations").where({ email: "race@example.com" });
  assert.equal(rows.length, 1);
});
