import assert from "node:assert/strict";
import test from "node:test";
import { createRepository as createUsersRepository } from "../src/server/common/repositories/usersRepository.js";
import { createRepository as createUserSettingsRepository } from "../src/server/common/repositories/userSettingsRepository.js";
import { createRepository as createWorkspaceInvitesRepository } from "../src/server/common/repositories/workspaceInvitesRepository.js";
import { createRepository as createWorkspaceMembershipsRepository } from "../src/server/common/repositories/workspaceMembershipsRepository.js";
import { createRepository as createWorkspacesRepository } from "../src/server/common/repositories/workspacesRepository.js";
import { createRepository as createWorkspaceSettingsRepository } from "../src/server/workspaceSettings/workspaceSettingsRepository.js";

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

test("users-core repositories expose withTransaction", async () => {
  const knex = createKnexStub();
  const repositories = [
    createUsersRepository(knex),
    createUserSettingsRepository(knex),
    createWorkspaceInvitesRepository(knex),
    createWorkspaceMembershipsRepository(knex),
    createWorkspacesRepository(knex),
    createWorkspaceSettingsRepository(knex)
  ];

  for (const repository of repositories) {
    assert.equal(typeof repository.withTransaction, "function");
    const result = await repository.withTransaction(async (trx) => ({ id: trx.trxId }));
    assert.deepEqual(result, { id: "trx-1" });
  }
});
