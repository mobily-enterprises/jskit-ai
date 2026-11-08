import assert from "node:assert/strict";
import test from "node:test";
import { createRepository as createConsoleSettingsRepository } from "../src/server/consoleSettings/consoleSettingsRepository.js";

// A console settings handle whose transaction hands its work the options with the transaction.
function createHandleStub() {
  return {
    async withTransaction(options, work) {
      return work({ ...options, trx: { trxId: "trx-1" } });
    }
  };
}

test("console-core repositories expose withTransaction", async () => {
  const repositories = [
    createConsoleSettingsRepository({ consoleSettings: createHandleStub() })
  ];

  for (const repository of repositories) {
    assert.equal(typeof repository.withTransaction, "function");
    const result = await repository.withTransaction({}, async (txOptions) => ({ id: txOptions.trx.trxId }));
    assert.deepEqual(result, { id: "trx-1" });
  }
});

test("console.settings reads and writes with only the caller's context and transaction", async () => {
  const calls = [];
  const record = { id: "1", ownerUserId: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  const consoleSettings = {
    async get(id, params, options) {
      calls.push(["get", options]);
      return { ...record };
    },
    async patch(id, changes, options) {
      calls.push(["patch", options]);
      Object.assign(record, changes);
      return { ...record };
    }
  };
  const repository = createConsoleSettingsRepository({ consoleSettings });
  const trx = { trxId: "trx-1" };
  const context = { actor: { id: "7" } };
  // Settings a caller named for its own call (a format, a lock version, a returning) never reach these reads and writes.
  const callerOptions = { context, trx, format: "jsonapi", lockVersion: 3, returning: "records" };
  assert.equal(await repository.ensureOwnerUserId("7", callerOptions), "7");
  await repository.updateSingleton(callerOptions);
  assert.deepEqual(calls, [
    ["get", { context, trx, missing: "skip" }],
    ["patch", { context, trx, onlyIf: { ownerUserId: null }, missing: "skip", returning: "none" }],
    ["get", { context, trx, missing: "skip" }],
    ["get", { context, trx, missing: "skip" }],
    ["patch", { context, trx }]
  ]);
});
