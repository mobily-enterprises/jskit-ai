import assert from "node:assert/strict";
import test from "node:test";
import { createRepository as createAssistantConfigRepository } from "../src/server/repositories/assistantConfigRepository.js";
import { createRepository as createConversationsRepository } from "../src/server/repositories/conversationsRepository.js";
import { createRepository as createMessagesRepository } from "../src/server/repositories/messagesRepository.js";

// A handle that runs no query and opens a stub transaction.
function createHandleStub() {
  return {
    async withTransaction(options, work) {
      return work({ ...options, trxId: "trx-1" });
    }
  };
}

function systemContext() {
  return { forUser: () => ({}), forWorkspace: () => ({}) };
}

test("assistant-runtime repositories expose withTransaction", async () => {
  const repositories = [
    createAssistantConfigRepository({ assistantConfig: createHandleStub(), systemContext }),
    createConversationsRepository({ conversations: createHandleStub(), systemContext }),
    createMessagesRepository({ messages: createHandleStub(), systemContext })
  ];

  for (const repository of repositories) {
    assert.equal(typeof repository.withTransaction, "function");
    const result = await repository.withTransaction({}, async (txOptions) => ({ id: txOptions.trxId }));
    assert.deepEqual(result, { id: "trx-1" });
  }
});
