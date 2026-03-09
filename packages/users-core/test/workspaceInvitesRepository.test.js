import assert from "node:assert/strict";
import test from "node:test";
import { createRepository } from "../src/server/repositories/workspaceInvites.repository.js";

function createKnexStub() {
  const state = {
    insertPayload: null
  };

  const row = {
    id: 1,
    workspace_id: 1,
    email: "invitee@example.com",
    role_id: "member",
    status: "pending",
    token_hash: "hash",
    invited_by_user_id: 1,
    expires_at: "2026-03-16 00:26:35.709",
    accepted_at: null,
    revoked_at: null,
    created_at: "2026-03-09 00:26:35.710",
    updated_at: "2026-03-09 00:26:35.710"
  };

  function tableBuilder(tableName) {
    assert.equal(tableName, "workspace_invites");
    return {
      insert(payload) {
        state.insertPayload = payload;
        return Promise.resolve([1]);
      },
      where(criteria) {
        assert.equal(typeof criteria, "object");
        return {
          first() {
            return Promise.resolve({ ...row });
          },
          orderBy() {
            return {
              first() {
                return Promise.resolve({ ...row });
              }
            };
          }
        };
      }
    };
  }

  return { knexStub: tableBuilder, state };
}

test("workspaceInvitesRepository.insert normalizes expiresAt ISO input to database datetime", async () => {
  const { knexStub, state } = createKnexStub();
  const repository = createRepository(knexStub);

  await repository.insert({
    workspaceId: 1,
    email: "invitee@example.com",
    roleId: "member",
    status: "pending",
    tokenHash: "hash",
    invitedByUserId: 1,
    expiresAt: "2026-03-16T00:26:35.709Z"
  });

  assert.equal(state.insertPayload.expires_at, "2026-03-16 00:26:35.709");
});
