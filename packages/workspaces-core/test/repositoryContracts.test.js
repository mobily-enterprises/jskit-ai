import assert from "node:assert/strict";
import test from "node:test";
import { createRepository as createWorkspaceInvitesRepository } from "../src/server/common/repositories/workspaceInvitesRepository.js";
import { createRepository as createWorkspaceMembershipsRepository } from "../src/server/common/repositories/workspaceMembershipsRepository.js";
import { createRepository as createWorkspacesRepository } from "../src/server/common/repositories/workspacesRepository.js";
import { createRepository as createWorkspaceSettingsRepository } from "../src/server/workspaceSettings/workspaceSettingsRepository.js";

function createApiStub() {
  return {
    async transaction(work) {
      return work({ trxId: "managed-1" });
    },
    resources: {
      workspaceInvites: {},
      workspaceMemberships: {},
      workspaces: {},
      workspaceSettings: {}
    }
  };
}

test("workspaces-core repositories delegate transaction ownership and failures to the API", async () => {
  const api = createApiStub();
  const repositories = [
    createWorkspaceInvitesRepository({ api }),
    createWorkspaceMembershipsRepository({ api }),
    createWorkspacesRepository({ api }),
    createWorkspaceSettingsRepository({ api })
  ];

  for (const repository of repositories) {
    assert.equal(typeof repository.withTransaction, "function");
    const result = await repository.withTransaction(async (trx) => ({ id: trx.trxId }));
    assert.deepEqual(result, { id: "managed-1" });
    const failure = new Error("Participant failed");
    await assert.rejects(repository.withTransaction(async () => { throw failure; }), error => error === failure);
  }
});

const duplicateRecoveryCases = [
  ["settings", createWorkspaceSettingsRepository, "workspaceSettings", repository => repository.ensureForWorkspaceId("7")],
  ["owner membership", createWorkspaceMembershipsRepository, "workspaceMemberships", repository => repository.ensureOwnerMembership("7", "9")],
  ["membership", createWorkspaceMembershipsRepository, "workspaceMemberships", repository => repository.upsertMembership("7", "9")],
  ["invite", createWorkspaceInvitesRepository, "workspaceInvites", repository => repository.insert({ workspaceId: "7", email: "ada@example.com" })],
  ["workspace", createWorkspacesRepository, "workspaces", repository => repository.insert({ ownerUserId: "9", slug: "shared" })]
];

for (const [name, createRepository, resourceName, write] of duplicateRecoveryCases) {
  for (const outcome of ["pending", "committed", "unknown"]) {
    test(`${name} preserves a ${outcome} duplicate failure without a fallback query`, async () => {
      let reads = 0;
      let writeStarted = false;
      const failure = Object.assign(new Error("Write failed"), {
        transactionOutcome: outcome, cause: { code: "ER_DUP_ENTRY" }
      });
      const api = createApiStub();
      api.resources[resourceName] = {
        async query() {
          assert.equal(writeStarted, false, "A failed transaction cannot support duplicate recovery");
          reads += 1;
          return { data: [] };
        },
        async post() { writeStarted = true; throw failure; }
      };
      const repository = createRepository({ api });
      await assert.rejects(write(repository), error => error === failure);
      assert.equal(reads, ["invite", "workspace"].includes(name) ? 0 : 1);
    });
  }
}
