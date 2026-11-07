import assert from "node:assert/strict";
import test from "node:test";
import { createRepository as createWorkspaceInvitesRepository } from "../src/server/common/repositories/workspaceInvitesRepository.js";
import { createRepository as createWorkspaceMembershipsRepository } from "../src/server/common/repositories/workspaceMembershipsRepository.js";
import { createRepository as createWorkspacesRepository } from "../src/server/common/repositories/workspacesRepository.js";
import { createRepository as createWorkspaceSettingsRepository } from "../src/server/workspaceSettings/workspaceSettingsRepository.js";

// A table handle whose reads find nothing and whose creates fail with `failure`; it counts its reads.
function createHandleStub(failure = new Error("Unexpected write")) {
  const stub = {
    reads: 0,
    writeStarted: false,
    async withTransaction(options, work) {
      return work(Object.freeze({ ...options, trx: { trxId: "managed-1" } }));
    },
    inTransaction(options) {
      return Boolean(options.trx);
    },
    async query({ page }) {
      assert.equal(stub.writeStarted, false, "A failed transaction cannot support duplicate recovery");
      stub.reads += 1;
      return { records: [], page: { size: page.size, hasMore: false, next: null } };
    },
    async queryAll() {
      assert.equal(stub.writeStarted, false, "A failed transaction cannot support duplicate recovery");
      stub.reads += 1;
      return [];
    },
    async create() {
      stub.writeStarted = true;
      throw failure;
    }
  };
  return stub;
}

const repositoryFactories = {
  invite: (handle) => createWorkspaceInvitesRepository({
    workspaceInvites: handle,
    workspaces: createWorkspacesRepository({ workspaces: createHandleStub(), workspaceMemberships: createHandleStub() })
  }),
  membership: (handle) => createWorkspaceMembershipsRepository({ workspaceMemberships: handle }),
  workspace: (handle) => createWorkspacesRepository({ workspaces: handle, workspaceMemberships: createHandleStub() }),
  settings: (handle) => createWorkspaceSettingsRepository({
    workspaceSettings: handle,
    defaultInvitesEnabled: true,
    defaultColorSettings: {}
  })
};

test("workspaces-core repositories delegate transaction ownership and failures to their table's handle", async () => {
  for (const createRepository of Object.values(repositoryFactories)) {
    const repository = createRepository(createHandleStub());
    assert.equal(typeof repository.withTransaction, "function");
    const result = await repository.withTransaction({}, async (txOptions) => ({ id: txOptions.trx.trxId }));
    assert.deepEqual(result, { id: "managed-1" });
    const failure = new Error("Participant failed");
    await assert.rejects(repository.withTransaction({}, async () => { throw failure; }), error => error === failure);
  }
  for (const name of ["invite", "workspace"]) {
    const repository = repositoryFactories[name](createHandleStub());
    assert.equal(repository.inTransaction({}), false);
    assert.equal(await repository.withTransaction({}, async (txOptions) => repository.inTransaction(txOptions)), true);
  }
});

const duplicateRecoveryCases = [
  ["settings", "settings", repository => repository.ensureForWorkspaceId("7")],
  ["owner membership", "membership", repository => repository.ensureOwnerMembership("7", "9")],
  ["membership", "membership", repository => repository.upsertMembership("7", "9")],
  ["invite", "invite", repository => repository.insert({ workspaceId: "7", email: "ada@example.com" })],
  ["workspace", "workspace", repository => repository.insert({ ownerUserId: "9", slug: "shared" })]
];

for (const [name, factory, write] of duplicateRecoveryCases) {
  for (const outcome of ["pending", "committed", "unknown"]) {
    test(`${name} preserves a ${outcome} duplicate failure without a fallback query`, async () => {
      const failure = Object.assign(new Error("Write failed"), {
        transactionOutcome: outcome, cause: { code: "ER_DUP_ENTRY" }
      });
      const handle = createHandleStub(failure);
      const repository = repositoryFactories[factory](handle);
      await assert.rejects(write(repository), error => error === failure);
      assert.equal(handle.reads, ["invite", "workspace"].includes(name) ? 0 : 1);
    });
  }
}
