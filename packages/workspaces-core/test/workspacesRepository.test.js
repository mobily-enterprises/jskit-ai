import assert from "node:assert/strict";
import test from "node:test";
import { toIsoString } from "@jskit-ai/database-runtime/shared";
import { createRepository } from "../src/server/common/repositories/workspacesRepository.js";

function asCollectionDocument(rows = []) {
  return {
    data: Array.isArray(rows) ? rows : []
  };
}

function toWorkspaceRow(row = {}) {
  return {
    id: String(row.id || ""),
    slug: row.slug,
    name: row.name,
    owner: row.ownerUserId == null ? null : { id: String(row.ownerUserId) },
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
        async query({ queryParams, format }) {
          assert.equal(format, "plain");
          const filters = queryParams?.filters || {};

          if (Object.hasOwn(filters, "id")) {
            const row = rowsById.get(String(filters.id)) || null;
            return asCollectionDocument(row ? [toWorkspaceRow(row)] : []);
          }

          if (Object.hasOwn(filters, "slug")) {
            const row = rowsBySlug.get(String(filters.slug)) || null;
            return asCollectionDocument(row ? [toWorkspaceRow(row)] : []);
          }

          if (Object.hasOwn(filters, "owner") && Object.hasOwn(filters, "isPersonal")) {
            const rows = personalRowsByOwnerId.get(String(filters.owner)) || [];
            return asCollectionDocument(rows.map((row) => toWorkspaceRow(row)));
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
          if (insertError) {
            throw insertError;
          }

          const row = {
            id: "1",
            slug: String(data.slug || ""),
            name: String(data.name || ""),
            ownerUserId: String(data.owner || ""),
            isPersonal: Boolean(data.isPersonal),
            avatarUrl: String(data.avatarUrl || ""),
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            deletedAt: null
          };
          rowsById.set(row.id, row);
          if (row.slug) {
            rowsBySlug.set(row.slug, row);
          }
          return toWorkspaceRow(row);
        },
        async patch(payload) {
          const data = payload?.data || {};
          assert.equal(payload.format, "plain");
          assert.equal(payload.returning, "full");
          assert.equal(payload.inputRecord, undefined);
          assert.equal(payload.document, undefined);
          state.patchPayload = payload;
          const existing = rowsById.get(String(payload.id)) || {
            id: String(payload.id)
          };
          const updated = {
            ...existing,
            ...data,
            ...(data.owner
              ? { ownerUserId: String(data.owner) }
              : {}),
            id: String(payload.id)
          };
          rowsById.set(updated.id, updated);
          if (updated.slug) {
            rowsBySlug.set(String(updated.slug), updated);
          }
          return toWorkspaceRow(updated);
        }
      },
      workspaceMemberships: {
        async query({ queryParams, format }) {
          assert.equal(format, "plain");
          const filters = queryParams?.filters || {};
          if (Object.hasOwn(filters, "user") && Object.hasOwn(filters, "status")) {
            const rows = membershipRows.filter((row) => (
              String(row?.user?.id || "") === String(filters.user) &&
              String(row?.status || "") === String(filters.status)
            ));
            return asCollectionDocument(rows.map((row) => toWorkspaceMembershipRow(row)));
          }

          return asCollectionDocument([]);
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
  const repository = createRepository({ api });

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
  const repository = createRepository({ api });

  const workspace = await repository.findPersonalByOwnerUserId("9");

  assert.equal(workspace?.id, "7");
  assert.equal(workspace?.slug, "first-workspace");
});

test("workspacesRepository.insert writes canonical fields through json-rest-api", async () => {
  const { api, state } = createWorkspacesApiStub();
  const repository = createRepository({ api });

  const inserted = await repository.insert({
    slug: "TonyMobily3",
    name: "TonyMobily3",
    ownerUserId: "9",
    avatarUrl: "",
    isPersonal: false
  });

  assert.equal(state.postPayload.data.owner, "9");
  assert.equal(state.postPayload.data.slug, "TonyMobily3");
  assert.equal(state.postPayload.data.name, "TonyMobily3");
  assert.equal(state.postPayload.data.isPersonal, false);
  assert.equal(state.postPayload.data.avatarUrl, "");
  assert.equal(typeof state.postPayload.data.createdAt, "string");
  assert.equal(state.postPayload.data.updatedAt, state.postPayload.data.createdAt);
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
    insertError: { code: "REST_API_WRITE", transactionOutcome: "rolledBack", cause: { code: "ER_DUP_ENTRY" } }
  });
  const repository = createRepository({ api });

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
  const repository = createRepository({ api });

  await repository.updateById("7", {
    name: "TonyMobily 4"
  });

  assert.equal(state.patchPayload.id, "7");
  assert.equal(state.patchPayload.data.name, "TonyMobily 4");
  assert.equal(typeof state.patchPayload.data.updatedAt, "string");
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
  const repository = createRepository({ api });

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
