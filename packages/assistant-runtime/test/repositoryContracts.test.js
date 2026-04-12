import assert from "node:assert/strict";
import test from "node:test";
import { createRepository as createAssistantConfigRepository } from "../src/server/repositories/assistantConfigRepository.js";
import { createRepository as createConversationsRepository } from "../src/server/repositories/conversationsRepository.js";
import { createRepository as createMessagesRepository } from "../src/server/repositories/messagesRepository.js";

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

test("assistant-runtime repositories expose withTransaction", async () => {
  const knex = createKnexStub();
  const repositories = [
    createAssistantConfigRepository(knex),
    createConversationsRepository(knex),
    createMessagesRepository(knex)
  ];

  for (const repository of repositories) {
    assert.equal(typeof repository.withTransaction, "function");
    const result = await repository.withTransaction(async (trx) => ({ id: trx.trxId }));
    assert.deepEqual(result, { id: "trx-1" });
  }
});
