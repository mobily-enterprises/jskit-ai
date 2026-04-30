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
          const includeWorkspace = Array.isArray(queryParams?.include) && queryParams.include.includes("workspace");
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

          return {
            data: matching.map((row) => includeWorkspace ? { ...row } : { ...row, workspace: row.workspace })
          };
        },
        async post(payload) {
          assert.equal(payload?.simplified, true);
          const inputRecord = payload?.inputRecord || {};
          state.postPayload = { ...inputRecord };
          const row = {
            id: "1",
            workspace: { id: String(inputRecord.workspace) },
            email: inputRecord.email,
            roleSid: inputRecord.roleSid,
            status: inputRecord.status,
            tokenHash: inputRecord.tokenHash,
            invitedByUser: inputRecord.invitedByUser ? { id: String(inputRecord.invitedByUser) } : null,
            expiresAt: inputRecord.expiresAt,
            acceptedAt: inputRecord.acceptedAt,
            revokedAt: inputRecord.revokedAt,
            createdAt: "2026-03-09 00:26:35.710",
            updatedAt: "2026-03-09 00:26:35.710"
          };
          rows.push(row);
          rowById.set("1", row);
          return { ...row };
        },
        async patch(payload) {
          assert.equal(payload?.simplified, true);
          const inputRecord = payload?.inputRecord || {};
          state.patchPayloads.push({ ...inputRecord });
          const existing = rowById.get(String(inputRecord.id));
          if (existing) {
            const updated = {
              ...existing,
              ...inputRecord
            };
            rowById.set(String(inputRecord.id), updated);
          }
          return rowById.get(String(inputRecord.id)) || null;
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

  assert.equal(state.postPayload.workspace, "1");
  assert.equal(state.postPayload.email, "invitee@example.com");
  assert.equal(state.postPayload.invitedByUser, "1");
  assert.equal(state.postPayload.tokenHash, "hash");
  assert.equal(typeof state.postPayload.expiresAt, "string");
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
  assert.equal(payload.status, "accepted");
  assert.equal(typeof payload.acceptedAt, "object");
  assert.equal(typeof payload.updatedAt, "object");
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
