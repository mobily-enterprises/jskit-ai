import assert from "node:assert/strict";
import test from "node:test";
import { toIsoString } from "@jskit-ai/database-runtime/shared";
import { createRepository } from "../src/server/common/repositories/workspaceInvitesRepository.js";

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

function asCollectionDocument(rows = []) {
  return {
    data: Array.isArray(rows) ? rows : []
  };
}

function toWorkspaceInviteRow(row = {}) {
  return {
    id: String(row.id || ""),
    workspaceId: row?.workspace?.id == null ? null : String(row.workspace.id),
    workspace: row?.workspace?.id == null ? null : {
      ...row.workspace,
      id: String(row.workspace.id)
    },
    email: row.email,
    roleSid: row.roleSid,
    status: row.status,
    tokenHash: row.tokenHash,
    invitedByUserId: row?.invitedByUser?.id == null ? null : String(row.invitedByUser.id),
    invitedByUser: row?.invitedByUser?.id == null ? null : {
      ...row.invitedByUser,
      id: String(row.invitedByUser.id)
    },
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function createWorkspaceInvitesApiStub({
  rows = [],
  rowById = new Map()
} = {}) {
  const state = {
    postPayload: null,
    patchPayloads: []
  };

  const api = {
    resources: {
      workspaceInvites: {
        async query({ queryParams }) {
          const filters = queryParams?.filters || {};
          const matching = rows.filter((row) => {
            if (Object.hasOwn(filters, "id") && String(row.id) !== String(filters.id)) {
              return false;
            }
            if (Object.hasOwn(filters, "workspace") && String(row?.workspace?.id || "") !== String(filters.workspace)) {
              return false;
            }
            if (Object.hasOwn(filters, "email") && String(row.email || "") !== String(filters.email)) {
              return false;
            }
            if (Object.hasOwn(filters, "status") && String(row.status || "") !== String(filters.status)) {
              return false;
            }
            if (Object.hasOwn(filters, "tokenHash") && String(row.tokenHash || "") !== String(filters.tokenHash)) {
              return false;
            }
            return true;
          });

          return asCollectionDocument(matching.map((row) => toWorkspaceInviteRow(row)));
        },
        async post(payload) {
          const inputRecord = payload?.inputRecord?.data || {};
          state.postPayload = inputRecord;
          const row = {
            id: "1",
            workspace: { id: String(inputRecord.relationships?.workspace?.data?.id || "") },
            email: inputRecord.attributes?.email,
            roleSid: inputRecord.attributes?.roleSid,
            status: inputRecord.attributes?.status,
            tokenHash: inputRecord.attributes?.tokenHash,
            invitedByUser: inputRecord.relationships?.invitedByUser?.data
              ? { id: String(inputRecord.relationships.invitedByUser.data.id) }
              : null,
            expiresAt: inputRecord.attributes?.expiresAt,
            acceptedAt: inputRecord.attributes?.acceptedAt,
            revokedAt: inputRecord.attributes?.revokedAt,
            createdAt: "2026-03-09 00:26:35.710",
            updatedAt: "2026-03-09 00:26:35.710"
          };
          rows.push(row);
          rowById.set("1", row);
          return toWorkspaceInviteRow(row);
        },
        async patch(payload) {
          const inputRecord = payload?.inputRecord?.data || {};
          state.patchPayloads.push(inputRecord);
          const existing = rowById.get(String(inputRecord.id));
          if (existing) {
            const updated = {
              ...existing,
              ...(inputRecord.attributes || {})
            };
            rowById.set(String(inputRecord.id), updated);
          }
          const updatedRow = rowById.get(String(inputRecord.id)) || null;
          return updatedRow ? toWorkspaceInviteRow(updatedRow) : null;
        }
      }
    }
  };

  return { api, state };
}

test("workspaceInvitesRepository.insert preserves expiresAt and relationship fields through the resource write path", async () => {
  const { api, state } = createWorkspaceInvitesApiStub();
  const repository = createRepository({ api, knex: createKnexStub() });

  await repository.insert({
    workspaceId: "1",
    email: "invitee@example.com",
    roleSid: "member",
    status: "pending",
    tokenHash: "hash",
    invitedByUserId: "1",
    expiresAt: "2026-03-16T00:26:35.709Z"
  });

  assert.equal(state.postPayload.relationships?.workspace?.data?.id, "1");
  assert.equal(state.postPayload.attributes?.email, "invitee@example.com");
  assert.equal(state.postPayload.relationships?.invitedByUser?.data?.id, "1");
  assert.equal(state.postPayload.attributes?.tokenHash, "hash");
  assert.equal(typeof state.postPayload.attributes?.expiresAt, "string");
});

test("workspaceInvitesRepository.findPendingByTokenHash reads from the canonical invite resource without workspace data", async () => {
  const { api } = createWorkspaceInvitesApiStub({
    rows: [
      {
        id: "44",
        workspace: { id: "9" },
        email: "invitee@example.com",
        roleSid: "member",
        status: "pending",
        tokenHash: "hash-token",
        invitedByUser: { id: "1" },
        expiresAt: "2030-01-01 00:00:00.000",
        acceptedAt: null,
        revokedAt: null,
        createdAt: "2026-03-09 00:26:35.710",
        updatedAt: "2026-03-09 00:26:35.710"
      }
    ]
  });
  const repository = createRepository({ api, knex: createKnexStub() });

  const invite = await repository.findPendingByTokenHash("hash-token");

  assert.equal(invite?.workspaceId, "9");
  assert.equal(invite?.workspaceSlug, undefined);
});

test("workspaceInvitesRepository.markAcceptedById uses the internal invite resource for normalized patch writes", async () => {
  const { api, state } = createWorkspaceInvitesApiStub({
    rowById: new Map([
      ["1", {
        id: "1",
        workspace: { id: "1" },
        email: "invitee@example.com",
        roleSid: "member",
        status: "accepted",
        tokenHash: "hash",
        invitedByUser: { id: "1" },
        expiresAt: "2026-03-16 00:26:35.709",
        acceptedAt: "2026-03-10 00:26:35.710",
        revokedAt: null,
        createdAt: "2026-03-09 00:26:35.710",
        updatedAt: "2026-03-10 00:26:35.710"
      }]
    ])
  });
  const repository = createRepository({ api, knex: createKnexStub() });

  await repository.markAcceptedById("1");

  const payload = state.patchPayloads[0];
  assert.equal(payload.attributes?.status, "accepted");
  assert.equal(typeof payload.attributes?.acceptedAt, "object");
  assert.equal(typeof payload.attributes?.updatedAt, "object");
});

test("workspaceInvitesRepository.listPendingByWorkspaceIdWithWorkspace keeps workspace join fields outside the base resource contract", async () => {
  const { api } = createWorkspaceInvitesApiStub({
    rows: [
      {
        id: "1",
        workspace: {
          id: "9",
          slug: "tonymobily3",
          name: "TonyMobily3",
          avatarUrl: "https://example.com/avatar.png"
        },
        email: "invitee@example.com",
        roleSid: "member",
        status: "pending",
        tokenHash: "hash-token",
        invitedByUser: { id: "1" },
        expiresAt: "2030-01-01 00:00:00.000",
        acceptedAt: null,
        revokedAt: null,
        createdAt: "2026-03-09 00:26:35.710",
        updatedAt: "2026-03-09 00:26:35.710"
      }
    ]
  });
  const repository = createRepository({ api, knex: createKnexStub() });

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
