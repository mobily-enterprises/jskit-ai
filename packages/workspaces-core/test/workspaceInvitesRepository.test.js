import assert from "node:assert/strict";
import test from "node:test";
import { toIsoString, toNullableDateTime } from "@jskit-ai/database-runtime/shared";
import { createRepository } from "../src/server/common/repositories/workspaceInvitesRepository.js";

function createKnexStub({
  rowById = new Map(),
  pendingRow = null,
  joinedRows = []
} = {}) {
  const state = {
    insertPayload: null,
    updatePayload: null
  };

  const defaultRow = pendingRow || {
    id: 1,
    workspace_id: 1,
    email: "invitee@example.com",
    role_sid: "member",
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
    if (tableName === "workspace_invites as wi") {
      return {
        join() {
          return this;
        },
        where() {
          return this;
        },
        orderBy() {
          return this;
        },
        select() {
          return Promise.resolve([...joinedRows]);
        }
      };
    }

    assert.equal(tableName, "workspace_invites");
    const query = {
      criteriaList: [],
      select() {
        return this;
      },
      insert(payload) {
        state.insertPayload = payload;
        return Promise.resolve([1]);
      },
      where(criteria) {
        this.criteriaList.push(criteria);
        return this;
      },
      orderBy() {
        return this;
      },
      update(payload) {
        state.updatePayload = payload;
        return Promise.resolve(1);
      },
      first() {
        const criteria = Object.assign({}, ...this.criteriaList);
        if (Object.hasOwn(criteria, "id")) {
          return Promise.resolve(rowById.get(String(criteria.id)) || null);
        }
        return Promise.resolve({ ...defaultRow });
      }
    };

    return query;
  }

  return { knexStub: tableBuilder, state };
}

test("workspaceInvitesRepository.insert normalizes expiresAt ISO input to database datetime", async () => {
  const { knexStub, state } = createKnexStub();
  const repository = createRepository(knexStub);

  await repository.insert({
    workspaceId: "1",
    email: "invitee@example.com",
    roleSid: "member",
    status: "pending",
    tokenHash: "hash",
    invitedByUserId: "1",
    expiresAt: "2026-03-16T00:26:35.709Z"
  });

  assert.equal(state.insertPayload.expires_at, toNullableDateTime("2026-03-16T00:26:35.709Z"));
});

test("workspaceInvitesRepository.findPendingByTokenHash reads from invites table without workspace join", async () => {
  const calls = {
    tableName: "",
    whereCriteria: null
  };
  const row = {
    id: 44,
    workspace_id: 9,
    email: "invitee@example.com",
    role_sid: "member",
    status: "pending",
    token_hash: "hash-token",
    invited_by_user_id: 1,
    expires_at: "2030-01-01 00:00:00.000",
    accepted_at: null,
    revoked_at: null,
    created_at: "2026-03-09 00:26:35.710",
    updated_at: "2026-03-09 00:26:35.710"
  };

  const repository = createRepository((tableName) => {
    calls.tableName = String(tableName || "");
    return {
      select() {
        return this;
      },
      where(criteria) {
        calls.whereCriteria = criteria;
        return this;
      },
      first() {
        return Promise.resolve({ ...row });
      }
    };
  });

  const invite = await repository.findPendingByTokenHash("hash-token");
  assert.equal(calls.tableName, "workspace_invites");
  assert.deepEqual(calls.whereCriteria, {
    token_hash: "hash-token",
    status: "pending"
  });
  assert.equal(invite?.workspaceId, "9");
  assert.equal(invite?.workspaceSlug, undefined);
});

test("workspaceInvitesRepository.markAcceptedById uses the internal invite resource for normalized patch writes", async () => {
  const acceptedRow = {
    id: 1,
    workspace_id: 1,
    email: "invitee@example.com",
    role_sid: "member",
    status: "accepted",
    token_hash: "hash",
    invited_by_user_id: 1,
    expires_at: "2026-03-16 00:26:35.709",
    accepted_at: "2026-03-10 00:26:35.710",
    revoked_at: null,
    created_at: "2026-03-09 00:26:35.710",
    updated_at: "2026-03-10 00:26:35.710"
  };
  const { knexStub, state } = createKnexStub({
    rowById: new Map([["1", acceptedRow]])
  });
  const repository = createRepository(knexStub);

  await repository.markAcceptedById("1");

  assert.equal(state.updatePayload.status, "accepted");
  assert.equal(typeof state.updatePayload.accepted_at, "string");
  assert.match(state.updatePayload.accepted_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
  assert.equal(typeof state.updatePayload.updated_at, "string");
  assert.match(state.updatePayload.updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
});

test("workspaceInvitesRepository.listPendingByWorkspaceIdWithWorkspace keeps workspace join fields outside the base resource contract", async () => {
  const { knexStub } = createKnexStub({
    joinedRows: [
      {
        id: 1,
        workspace_id: 9,
        email: "invitee@example.com",
        role_sid: "member",
        status: "pending",
        token_hash: "hash-token",
        invited_by_user_id: 1,
        expires_at: "2030-01-01 00:00:00.000",
        accepted_at: null,
        revoked_at: null,
        created_at: "2026-03-09 00:26:35.710",
        updated_at: "2026-03-09 00:26:35.710",
        workspace_slug: "tonymobily3",
        workspace_name: "TonyMobily3",
        workspace_avatar_url: "https://example.com/avatar.png"
      }
    ]
  });
  const repository = createRepository(knexStub);

  const invites = await repository.listPendingByWorkspaceIdWithWorkspace("9");

  assert.deepEqual(invites, [
    {
      id: "1",
      workspaceId: "9",
      email: "invitee@example.com",
      roleSid: "member",
      status: "pending",
      tokenHash: "hash-token",
      invitedByUserId: "1",
      expiresAt: toIsoString("2030-01-01 00:00:00.000"),
      acceptedAt: null,
      revokedAt: null,
      createdAt: toIsoString("2026-03-09 00:26:35.710"),
      updatedAt: toIsoString("2026-03-09 00:26:35.710"),
      workspaceSlug: "tonymobily3",
      workspaceName: "TonyMobily3",
      workspaceAvatarUrl: "https://example.com/avatar.png"
    }
  ]);
});
