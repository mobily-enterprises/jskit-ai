import assert from "node:assert/strict";
import test from "node:test";
import { toIsoString } from "@jskit-ai/database-runtime/shared";
import { createRepository } from "../src/server/common/repositories/workspaceMembershipsRepository.js";

function asCollectionDocument(rows = []) {
  return {
    data: Array.isArray(rows) ? rows : []
  };
}

function toWorkspaceMembershipRow(row = {}) {
  return {
    id: String(row.id || ""),
    workspace: row?.workspace?.id == null ? null : {
      ...row.workspace,
      id: String(row.workspace.id)
    },
    user: row?.user?.id == null
      ? null
      : {
          ...row.user,
          id: String(row.user.id)
        },
    roleSid: row.roleSid,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function createWorkspaceMembershipsApiStub({
  rowByComposite = new Map(),
  memberSummaryRows = [],
  rowById = new Map()
} = {}) {
  const state = {
    postPayload: null,
    patchPayload: null,
    queryCalls: []
  };

  const api = {
    resources: {
      workspaceMemberships: {
        async query({ queryParams, format }) {
          assert.equal(format, "plain");
          state.queryCalls.push(queryParams || {});
          const filters = queryParams?.filters || {};
          const includeUser = Array.isArray(queryParams?.include) && queryParams.include.includes("user");

          if (Object.hasOwn(filters, "workspace") && Object.hasOwn(filters, "user")) {
            const includeWorkspace = Array.isArray(queryParams?.include) && queryParams.include.includes("workspace");
            const includeUser = Array.isArray(queryParams?.include) && queryParams.include.includes("user");
            const row = rowByComposite.get(`${filters.workspace}:${filters.user}`) || null;
            return asCollectionDocument(row
              ? [toWorkspaceMembershipRow({
                  ...row,
                  workspace: includeWorkspace ? row.workspace : null,
                  user: includeUser ? row.user : null
                })]
              : []);
          }

          if (Object.hasOwn(filters, "workspace") && Object.hasOwn(filters, "status") && includeUser) {
            return asCollectionDocument(memberSummaryRows.map((row) => toWorkspaceMembershipRow(row)));
          }

          if (Object.hasOwn(filters, "user") && Object.hasOwn(filters, "status")) {
            const includeWorkspace = Array.isArray(queryParams?.include) && queryParams.include.includes("workspace");
            const rows = [...rowByComposite.values()].filter((row) => (
              String(row?.user?.id || "") === String(filters.user) &&
              String(row?.status || "") === String(filters.status)
            ));
            return asCollectionDocument(rows.map((row) => {
              if (includeWorkspace) {
                return toWorkspaceMembershipRow(row);
              }

              return {
                ...toWorkspaceMembershipRow({
                  ...row,
                  workspace: null
                })
              };
            }));
          }

          return asCollectionDocument([]);
        },
        async post(payload) {
          const data = payload?.data || {};
          assert.equal(payload.format, "plain");
          assert.equal(payload.returning, "full");
          assert.equal(payload.inputRecord, undefined);
          assert.equal(payload.document, undefined);
          state.postPayload = payload;
          const row = rowById.get("1") || {
            id: "1",
            workspace: { id: String(data.workspace || "") },
            user: { id: String(data.user || "") },
            roleSid: String(data.roleSid || ""),
            status: String(data.status || ""),
            createdAt: "2026-03-09 00:26:35.710",
            updatedAt: "2026-03-09 00:26:35.710"
          };
          rowByComposite.set(`${row.workspace.id}:${row.user.id}`, row);
          rowById.set(String(row.id), row);
          return toWorkspaceMembershipRow(row);
        },
        async patch(payload) {
          const data = payload?.data || {};
          assert.equal(payload.format, "plain");
          assert.equal(payload.returning, "full");
          assert.equal(payload.inputRecord, undefined);
          assert.equal(payload.document, undefined);
          state.patchPayload = payload;
          const existing = rowById.get(String(payload.id));
          const updated = {
            ...(existing || {}),
            ...data,
            id: String(payload.id),
            workspace: existing?.workspace || { id: "" },
            user: existing?.user || { id: "" }
          };
          rowById.set(String(updated.id), updated);
          rowByComposite.set(`${updated.workspace.id}:${updated.user.id}`, updated);
          return toWorkspaceMembershipRow(updated);
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
  const repository = createRepository({ api });

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
  const repository = createRepository({ api });

  const membership = await repository.ensureOwnerMembership("7", "9");

  assert.equal(state.patchPayload.data.roleSid, "owner");
  assert.equal(state.patchPayload.data.status, "active");
  assert.equal(typeof state.patchPayload.data.updatedAt, "string");
  assert.deepEqual(membership, {
    id: "11",
    workspaceId: "7",
    userId: "9",
    roleSid: "owner",
    status: "active",
    createdAt: toIsoString("2026-03-09 00:26:35.710"),
    updatedAt: toIsoString(state.patchPayload.data.updatedAt)
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
  const repository = createRepository({ api });

  await repository.upsertMembership("7", "9", {
    roleSid: "ADMIN",
    status: "ACTIVE"
  });

  assert.equal(state.postPayload.data.workspace, "7");
  assert.equal(state.postPayload.data.user, "9");
  assert.equal(state.postPayload.data.roleSid, "admin");
  assert.equal(state.postPayload.data.status, "active");
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
  const repository = createRepository({ api });

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

test("workspaceMembershipsRepository.listActiveWorkspaceIdsByUserId returns normalized workspace ids from the canonical resource", async () => {
  const membershipRow = {
    id: "11",
    workspace: { id: "7" },
    user: { id: "9" },
    roleSid: "owner",
    status: "active",
    createdAt: "2026-03-09 00:26:35.710",
    updatedAt: "2026-03-10 00:26:35.710"
  };
  const { api, state } = createWorkspaceMembershipsApiStub({
    rowByComposite: new Map([["7:9", membershipRow]])
  });
  const repository = createRepository({ api });

  const workspaceIds = await repository.listActiveWorkspaceIdsByUserId("9");

  assert.deepEqual(workspaceIds, ["7"]);
  assert.deepEqual(state.queryCalls, [
    {
      filters: {
        user: "9",
        status: "active"
      },
      include: ["workspace"]
    }
  ]);
});
