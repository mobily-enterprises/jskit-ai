import assert from "node:assert/strict";
import test from "node:test";
import { toIsoString } from "@jskit-ai/database-runtime/shared";
import { createRepository } from "../src/server/common/repositories/workspacesRepository.js";

function createKnexStub() {
  return Object.assign(() => {
    throw new Error("query execution not expected");
  }, {
    async transaction(work) {
      return work({ trxId: "trx-1" });
    }
  });
}

function toWorkspaceRow(row = {}) {
  return {
    id: String(row.id || ""),
    slug: row.slug,
    name: row.name,
    ownerUserId: row.ownerUserId == null ? null : String(row.ownerUserId),
    isPersonal: row.isPersonal,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt
  };
}

function toWorkspaceMembershipRow(row = {}) {
  return {
    id: String(row.id || ""),
    roleSid: row.roleSid,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    user: row?.user?.id == null ? null : { ...row.user, id: String(row.user.id) },
    workspace: row?.workspace?.id == null ? null : toWorkspaceRow(row.workspace)
  };
}

function createWorkspacesApiStub({
  rowsById = new Map(),
  rowsBySlug = new Map(),
  personalRowsByOwnerId = new Map(),
  membershipRows = [],
  insertError = null
} = {}) {
  const state = {
    postPayload: null,
    patchPayload: null
  };

  const api = {
    resources: {
      workspaces: {
        async query({ queryParams }) {
          const filters = queryParams?.filters || {};

          if (Object.hasOwn(filters, "id")) {
            const row = rowsById.get(String(filters.id)) || null;
            return row ? [toWorkspaceRow(row)] : [];
          }

          if (Object.hasOwn(filters, "slug")) {
            const row = rowsBySlug.get(String(filters.slug)) || null;
            return row ? [toWorkspaceRow(row)] : [];
          }

          if (Object.hasOwn(filters, "owner") && Object.hasOwn(filters, "isPersonal")) {
            const rows = personalRowsByOwnerId.get(String(filters.owner)) || [];
            return rows.map((row) => toWorkspaceRow(row));
          }

          return [];
        },
        async post(payload) {
          const inputRecord = payload?.inputRecord?.data || {};
          state.postPayload = inputRecord;
          if (insertError) {
            throw insertError;
          }

          const row = {
            id: "1",
            slug: String(inputRecord.attributes?.slug || ""),
            name: String(inputRecord.attributes?.name || ""),
            ownerUserId: String(inputRecord.relationships?.owner?.data?.id || ""),
            isPersonal: Boolean(inputRecord.attributes?.isPersonal),
            avatarUrl: String(inputRecord.attributes?.avatarUrl || ""),
            createdAt: inputRecord.attributes?.createdAt,
            updatedAt: inputRecord.attributes?.updatedAt,
            deletedAt: null
          };
          rowsById.set(row.id, row);
          if (row.slug) {
            rowsBySlug.set(row.slug, row);
          }
          return toWorkspaceRow(row);
        },
        async patch(payload) {
          const inputRecord = payload?.inputRecord?.data || {};
          state.patchPayload = inputRecord;
          const existing = rowsById.get(String(inputRecord.id)) || {
            id: String(inputRecord.id)
          };
          const updated = {
            ...existing,
            ...(inputRecord.attributes || {}),
            ...(inputRecord.relationships?.owner?.data?.id
              ? { ownerUserId: String(inputRecord.relationships.owner.data.id) }
              : {}),
            id: String(inputRecord.id)
          };
          rowsById.set(updated.id, updated);
          if (updated.slug) {
            rowsBySlug.set(String(updated.slug), updated);
          }
          return toWorkspaceRow(updated);
        }
      },
      workspaceMemberships: {
        async query({ queryParams }) {
          const filters = queryParams?.filters || {};
          if (Object.hasOwn(filters, "user") && Object.hasOwn(filters, "status")) {
            const rows = membershipRows.filter((row) => (
              String(row?.user?.id || "") === String(filters.user) &&
              String(row?.status || "") === String(filters.status)
            ));
            return rows.map((row) => toWorkspaceMembershipRow(row));
          }

          return [];
        }
      }
    }
  };

  return { api, state };
}

test("workspacesRepository.findById reads a canonical workspace row through json-rest-api", async () => {
  const { api } = createWorkspacesApiStub({
    rowsById: new Map([
      ["7", {
        id: "7",
        slug: "tonymobily3",
        name: "TonyMobily3",
        ownerUserId: "9",
        isPersonal: true,
        avatarUrl: "",
        createdAt: "2026-03-09 00:26:35.710",
        updatedAt: "2026-03-10 00:26:35.710",
        deletedAt: null
      }]
    ])
  });
  const repository = createRepository({ api, knex: createKnexStub() });

  const workspace = await repository.findById("7");

  assert.deepEqual(workspace, {
    id: "7",
    slug: "tonymobily3",
    name: "TonyMobily3",
    ownerUserId: "9",
    isPersonal: true,
    avatarUrl: "",
    createdAt: toIsoString("2026-03-09 00:26:35.710"),
    updatedAt: toIsoString("2026-03-10 00:26:35.710"),
    deletedAt: null
  });
});

test("workspacesRepository.findPersonalByOwnerUserId returns the first personal workspace by canonical id order", async () => {
  const { api } = createWorkspacesApiStub({
    personalRowsByOwnerId: new Map([
      ["9", [
        {
          id: "12",
          slug: "later-workspace",
          name: "Later Workspace",
          ownerUserId: "9",
          isPersonal: true,
          avatarUrl: "",
          createdAt: "2026-03-09 00:26:35.710",
          updatedAt: "2026-03-09 00:26:35.710",
          deletedAt: null
        },
        {
          id: "7",
          slug: "first-workspace",
          name: "First Workspace",
          ownerUserId: "9",
          isPersonal: true,
          avatarUrl: "",
          createdAt: "2026-03-08 00:26:35.710",
          updatedAt: "2026-03-08 00:26:35.710",
          deletedAt: null
        }
      ]]
    ])
  });
  const repository = createRepository({ api, knex: createKnexStub() });

  const workspace = await repository.findPersonalByOwnerUserId("9");

  assert.equal(workspace?.id, "7");
  assert.equal(workspace?.slug, "first-workspace");
});

test("workspacesRepository.insert writes canonical fields through json-rest-api", async () => {
  const { api, state } = createWorkspacesApiStub();
  const repository = createRepository({ api, knex: createKnexStub() });

  const inserted = await repository.insert({
    slug: "TonyMobily3",
    name: "TonyMobily3",
    ownerUserId: "9",
    avatarUrl: "",
    isPersonal: false
  });

  assert.equal(state.postPayload.relationships?.owner?.data?.id, "9");
  assert.equal(state.postPayload.attributes?.slug, "TonyMobily3");
  assert.equal(state.postPayload.attributes?.name, "TonyMobily3");
  assert.equal(state.postPayload.attributes?.isPersonal, false);
  assert.equal(state.postPayload.attributes?.avatarUrl, "");
  assert.equal(typeof state.postPayload.attributes?.createdAt, "object");
  assert.equal(typeof state.postPayload.attributes?.updatedAt, "object");
  assert.equal(inserted.id, "1");
  assert.equal(inserted.ownerUserId, "9");
});

test("workspacesRepository.insert falls back to slug lookup on duplicate slug", async () => {
  const existingRow = {
    id: "12",
    slug: "shared-workspace",
    name: "Shared Workspace",
    ownerUserId: "9",
    isPersonal: false,
    avatarUrl: "",
    createdAt: "2026-03-09 00:26:35.710",
    updatedAt: "2026-03-09 00:26:35.710",
    deletedAt: null
  };
  const { api } = createWorkspacesApiStub({
    rowsBySlug: new Map([["shared-workspace", existingRow]]),
    insertError: { code: "ER_DUP_ENTRY" }
  });
  const repository = createRepository({ api, knex: createKnexStub() });

  const inserted = await repository.insert({
    slug: "shared-workspace",
    name: "Shared Workspace",
    ownerUserId: "9"
  });

  assert.equal(inserted?.id, "12");
  assert.equal(inserted?.slug, "shared-workspace");
});

test("workspacesRepository.updateById patches canonical fields and updatedAt", async () => {
  const { api, state } = createWorkspacesApiStub({
    rowsById: new Map([
      ["7", {
        id: "7",
        slug: "tonymobily3",
        name: "TonyMobily3",
        ownerUserId: "9",
        isPersonal: false,
        avatarUrl: "",
        createdAt: "2026-03-09 00:26:35.710",
        updatedAt: "2026-03-09 00:26:35.710",
        deletedAt: null
      }]
    ])
  });
  const repository = createRepository({ api, knex: createKnexStub() });

  await repository.updateById("7", {
    name: "TonyMobily 4"
  });

  assert.equal(state.patchPayload.id, "7");
  assert.equal(state.patchPayload.attributes?.name, "TonyMobily 4");
  assert.equal(typeof state.patchPayload.attributes?.updatedAt, "object");
});

test("workspacesRepository.listForUserId keeps membership fields outside the canonical workspace row", async () => {
  const { api } = createWorkspacesApiStub({
    membershipRows: [
      {
        user: { id: "9" },
        roleSid: "owner",
        status: "active",
        workspace: {
          id: "7",
          slug: "tonymobily3",
          name: "TonyMobily3",
          ownerUserId: "9",
          isPersonal: true,
          avatarUrl: "",
          createdAt: "2026-03-09 00:26:35.710",
          updatedAt: "2026-03-10 00:26:35.710",
          deletedAt: null
        }
      },
      {
        user: { id: "9" },
        roleSid: "member",
        status: "active",
        workspace: {
          id: "8",
          slug: "team-space",
          name: "Team Space",
          ownerUserId: "10",
          isPersonal: false,
          avatarUrl: "",
          createdAt: "2026-03-09 00:26:35.710",
          updatedAt: "2026-03-10 00:26:35.710",
          deletedAt: null
        }
      },
      {
        user: { id: "9" },
        roleSid: "member",
        status: "active",
        workspace: {
          id: "9",
          slug: "deleted-space",
          name: "Deleted Space",
          ownerUserId: "10",
          isPersonal: false,
          avatarUrl: "",
          createdAt: "2026-03-09 00:26:35.710",
          updatedAt: "2026-03-10 00:26:35.710",
          deletedAt: "2026-03-11 00:26:35.710"
        }
      }
    ]
  });
  const repository = createRepository({ api, knex: createKnexStub() });

  const workspaces = await repository.listForUserId("9");

  assert.deepEqual(workspaces, [
    {
      id: "7",
      slug: "tonymobily3",
      name: "TonyMobily3",
      ownerUserId: "9",
      isPersonal: true,
      avatarUrl: "",
      createdAt: toIsoString("2026-03-09 00:26:35.710"),
      updatedAt: toIsoString("2026-03-10 00:26:35.710"),
      deletedAt: null,
      roleSid: "owner",
      membershipStatus: "active"
    },
    {
      id: "8",
      slug: "team-space",
      name: "Team Space",
      ownerUserId: "10",
      isPersonal: false,
      avatarUrl: "",
      createdAt: toIsoString("2026-03-09 00:26:35.710"),
      updatedAt: toIsoString("2026-03-10 00:26:35.710"),
      deletedAt: null,
      roleSid: "member",
      membershipStatus: "active"
    }
  ]);
});
