import assert from "node:assert/strict";
import test from "node:test";
import { createRepository as createUsersRepository } from "../src/server/common/repositories/usersRepository.js";
import { createRepository as createUserSettingsRepository } from "../src/server/common/repositories/userSettingsRepository.js";

function createKnexStub() {
  const knex = Object.assign(() => {
    throw new Error("query execution not expected");
  }, {
    async transaction(work) {
      return work({ trxId: "trx-1" });
    }
  });

  return knex;
}

function createFindByEmailKnexStub(expectedRow) {
  const calls = [];
  const knex = Object.assign((tableName) => {
    assert.equal(tableName, "users");
    return {
      where(criteria) {
        calls.push(criteria);
        return {
          async first() {
            return expectedRow;
          }
        };
      }
    };
  }, {
    async transaction(work) {
      return work({ trxId: "trx-1" });
    }
  });

  return { knex, calls };
}

test("users-core repositories expose withTransaction", async () => {
  const knex = createKnexStub();
  const repositories = [
    createUsersRepository(knex),
    createUserSettingsRepository(knex)
  ];

  for (const repository of repositories) {
    assert.equal(typeof repository.withTransaction, "function");
    const result = await repository.withTransaction(async (trx) => ({ id: trx.trxId }));
    assert.deepEqual(result, { id: "trx-1" });
  }
});

test("usersRepository.findByEmail normalizes email lookup", async () => {
  const { knex, calls } = createFindByEmailKnexStub({
    id: 7,
    auth_provider: "supabase",
    auth_provider_user_sid: "supabase-user-7",
    email: "ada@example.com",
    username: "ada",
    display_name: "Ada Example",
    avatar_storage_key: null,
    avatar_version: null,
    avatar_updated_at: null,
    created_at: "2026-04-20T00:00:00.000Z"
  });
  const repository = createUsersRepository(knex);

  const profile = await repository.findByEmail(" ADA@EXAMPLE.COM ");

  assert.deepEqual(calls, [{ email: "ada@example.com" }]);
  assert.equal(profile?.id, "7");
  assert.equal(profile?.email, "ada@example.com");
  assert.equal(profile?.displayName, "Ada Example");
});
