import assert from "node:assert/strict";
import test from "node:test";
import { toIsoString } from "@jskit-ai/database-runtime/shared";
import { createRepository } from "../src/server/common/repositories/workspaceMembershipsRepository.js";

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

function createWorkspaceMembershipsApiStub({
  rowByComposite = new Map(),
  memberSummaryRows = [],
  rowById = new Map()
} = {}) {
  const state = {
    postPayload: null,
    patchPayload: null
  };

  const api = {
    resources: {
      workspaceMemberships: {
        async query({ queryParams }) {
          const filters = queryParams?.filters || {};
          const includeUser = Array.isArray(queryParams?.include) && queryParams.include.includes("user");

          if (Object.hasOwn(filters, "workspace") && Object.hasOwn(filters, "user")) {
            const row = rowByComposite.get(`${filters.workspace}:${filters.user}`) || null;
            return { data: row ? [{ ...row }] : [] };
          }

          if (Object.hasOwn(filters, "workspace") && Object.hasOwn(filters, "status") && includeUser) {
            return { data: memberSummaryRows.map((row) => ({ ...row })) };
          }

          if (Object.hasOwn(filters, "user") && Object.hasOwn(filters, "status")) {
            const rows = [...rowByComposite.values()].filter((row) => (
              String(row?.user?.id || "") === String(filters.user) &&
              String(row?.status || "") === String(filters.status)
            ));
            return { data: rows.map((row) => ({ ...row })) };
          }

          return { data: [] };
        },
        async post(payload) {
          state.postPayload = { ...payload };
          const row = rowById.get("1") || {
            id: "1",
            workspace: { id: String(payload.workspace) },
            user: { id: String(payload.user) },
            roleSid: String(payload.roleSid || ""),
            status: String(payload.status || ""),
            createdAt: "2026-03-09 00:26:35.710",
            updatedAt: "2026-03-09 00:26:35.710"
          };
          rowByComposite.set(`${payload.workspace}:${payload.user}`, row);
          rowById.set(String(row.id), row);
          return { ...row };
        },
        async patch(payload) {
          state.patchPayload = { ...payload };
          const existing = rowById.get(String(payload.id));
          const updated = {
            ...(existing || {}),
            ...payload,
            id: String(payload.id),
            workspace: existing?.workspace || { id: "" },
            user: existing?.user || { id: "" }
          };
          rowById.set(String(updated.id), updated);
          rowByComposite.set(`${updated.workspace.id}:${updated.user.id}`, updated);
          return { ...updated };
        }
      }
    }
  };

  return { api, state };
}

test("workspaceMembershipsRepository.findByWorkspaceIdAndUserId normalizes canonical membership rows via the internal resource", async () => {
  const membershipRow = {
    id: "11",
    workspace: { id: "7" },
    user: { id: "9" },
    roleSid: "owner",
    status: "active",
    createdAt: "2026-03-09 00:26:35.710",
    updatedAt: "2026-03-10 00:26:35.710"
  };
  const { api } = createWorkspaceMembershipsApiStub({
    rowByComposite: new Map([["7:9", membershipRow]])
  });
  const repository = createRepository({ api, knex: createKnexStub() });

  const membership = await repository.findByWorkspaceIdAndUserId("7", "9");

  assert.deepEqual(membership, {
    id: "11",
    workspaceId: "7",
    userId: "9",
    roleSid: "owner",
    status: "active",
    createdAt: toIsoString("2026-03-09 00:26:35.710"),
    updatedAt: toIsoString("2026-03-10 00:26:35.710")
  });
});

test("workspaceMembershipsRepository.ensureOwnerMembership upgrades an existing membership through the runtime update path", async () => {
  const existingRow = {
    id: "11",
    workspace: { id: "7" },
    user: { id: "9" },
    roleSid: "member",
    status: "pending",
    createdAt: "2026-03-09 00:26:35.710",
    updatedAt: "2026-03-09 00:26:35.710"
  };
  const refreshedRow = {
    ...existingRow,
    roleSid: "owner",
    status: "active",
    updatedAt: "2026-03-10 00:26:35.710"
  };
  const { api, state } = createWorkspaceMembershipsApiStub({
    rowById: new Map([["11", refreshedRow]]),
    rowByComposite: new Map([["7:9", existingRow]])
  });
  const repository = createRepository({ api, knex: createKnexStub() });

  const membership = await repository.ensureOwnerMembership("7", "9");

  assert.equal(state.patchPayload.roleSid, "owner");
  assert.equal(state.patchPayload.status, "active");
  assert.equal(typeof state.patchPayload.updatedAt, "object");
  assert.deepEqual(membership, {
    id: "11",
    workspaceId: "7",
    userId: "9",
    roleSid: "owner",
    status: "active",
    createdAt: toIsoString("2026-03-09 00:26:35.710"),
    updatedAt: toIsoString(state.patchPayload.updatedAt)
  });
});

test("workspaceMembershipsRepository.upsertMembership creates normalized memberships through the runtime create path", async () => {
  const createdRow = {
    id: "1",
    workspace: { id: "7" },
    user: { id: "9" },
    roleSid: "admin",
    status: "active",
    createdAt: "2026-03-09 00:26:35.710",
    updatedAt: "2026-03-09 00:26:35.710"
  };
  const { api, state } = createWorkspaceMembershipsApiStub({
    rowById: new Map([["1", createdRow]]),
    rowByComposite: new Map()
  });
  const repository = createRepository({ api, knex: createKnexStub() });

  await repository.upsertMembership("7", "9", {
    roleSid: "ADMIN",
    status: "ACTIVE"
  });

  assert.equal(state.postPayload.workspace, "7");
  assert.equal(state.postPayload.user, "9");
  assert.equal(state.postPayload.roleSid, "admin");
  assert.equal(state.postPayload.status, "active");
});

test("workspaceMembershipsRepository.listActiveByWorkspaceId keeps summary rows separate from the canonical membership resource", async () => {
  const { api } = createWorkspaceMembershipsApiStub({
    memberSummaryRows: [
      {
        user: {
          id: "9",
          displayName: "Chiara",
          email: "CHIARA@example.com"
        },
        roleSid: "owner",
        status: "active"
      }
    ]
  });
  const repository = createRepository({ api, knex: createKnexStub() });

  const members = await repository.listActiveByWorkspaceId("7");

  assert.deepEqual(members, [
    {
      userId: "9",
      roleSid: "owner",
      status: "active",
      displayName: "Chiara",
      email: "chiara@example.com"
    }
  ]);
});
