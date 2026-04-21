import assert from "node:assert/strict";
import test from "node:test";
import { toIsoString } from "@jskit-ai/database-runtime/shared";
import { createRepository } from "../src/server/common/repositories/workspacesRepository.js";

function createWorkspacesKnexStub({
  rowById = new Map(),
  rowBySlug = new Map(),
  insertError = null,
  membershipRows = []
} = {}) {
  const state = {
    insertPayload: null,
    updatePayload: null
  };

  function buildWorkspacesQuery(tableName) {
    const query = {
      tableName,
      selectedColumns: [],
      whereCriteria: [],
      orderByClauses: [],
      select(...columns) {
        this.selectedColumns = columns;
        return this;
      },
      where(criteria) {
        this.whereCriteria.push(criteria);
        return this;
      },
      orderBy(column, direction) {
        this.orderByClauses.push({ column, direction });
        return this;
      },
      async first() {
        const criteria = Object.assign({}, ...this.whereCriteria);
        if (Object.hasOwn(criteria, "w.id")) {
          return rowById.get(String(criteria["w.id"])) || null;
        }
        if (Object.hasOwn(criteria, "id")) {
          return rowById.get(String(criteria.id)) || null;
        }
        if (Object.hasOwn(criteria, "w.slug")) {
          return rowBySlug.get(String(criteria["w.slug"])) || null;
        }
        if (Object.hasOwn(criteria, "w.owner_user_id") && Object.hasOwn(criteria, "w.is_personal")) {
          for (const row of rowById.values()) {
            if (
              String(row.owner_user_id) === String(criteria["w.owner_user_id"]) &&
              Number(row.is_personal) === Number(criteria["w.is_personal"])
            ) {
              return row;
            }
          }
        }
        return null;
      },
      async insert(payload) {
        state.insertPayload = payload;
        if (insertError) {
          throw insertError;
        }
        return [1];
      },
      async update(payload) {
        state.updatePayload = payload;
        return 1;
      }
    };

    return query;
  }

  function buildMembershipsQuery() {
    return {
      join() {
        return this;
      },
      where() {
        return this;
      },
      whereNull() {
        return this;
      },
      orderBy() {
        return this;
      },
      select() {
        return Promise.resolve([...membershipRows]);
      }
    };
  }

  function knex(tableName) {
    if (tableName === "workspaces" || tableName === "workspaces as w") {
      return buildWorkspacesQuery(tableName);
    }
    if (tableName === "workspace_memberships as wm") {
      return buildMembershipsQuery();
    }
    throw new Error(`Unexpected table ${tableName}`);
  }

  knex.transaction = async (work) => work(knex);

  return { knex, state };
}

test("workspacesRepository.findById normalizes internal workspace fields via the internal resource", async () => {
  const { knex } = createWorkspacesKnexStub({
    rowById: new Map([
      [
        "7",
        {
          id: 7,
          slug: "tonymobily3",
          name: "TonyMobily3",
          owner_user_id: 9,
          is_personal: 1,
          avatar_url: "",
          created_at: "2026-03-09 00:26:35.710",
          updated_at: "2026-03-10 00:26:35.710",
          deleted_at: null
        }
      ]
    ])
  });
  const repository = createRepository(knex);

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

test("workspacesRepository.insert uses runtime normalization and timestamp columns", async () => {
  const insertedRow = {
    id: 1,
    slug: "tonymobily3",
    name: "TonyMobily3",
    owner_user_id: 9,
    is_personal: 0,
    avatar_url: "",
    created_at: "2026-03-09 00:26:35.710",
    updated_at: "2026-03-09 00:26:35.710",
    deleted_at: null
  };
  const { knex, state } = createWorkspacesKnexStub({
    rowById: new Map([["1", insertedRow]])
  });
  const repository = createRepository(knex);

  const inserted = await repository.insert({
    slug: "TonyMobily3",
    name: "TonyMobily3",
    ownerUserId: "9"
  });

  assert.equal(state.insertPayload.slug, "tonymobily3");
  assert.equal(state.insertPayload.name, "TonyMobily3");
  assert.equal(state.insertPayload.owner_user_id, "9");
  assert.equal(state.insertPayload.is_personal, false);
  assert.equal(state.insertPayload.avatar_url, "");
  assert.equal(typeof state.insertPayload.created_at, "string");
  assert.equal(typeof state.insertPayload.updated_at, "string");
  assert.deepEqual(inserted, {
    id: "1",
    slug: "tonymobily3",
    name: "TonyMobily3",
    ownerUserId: "9",
    isPersonal: false,
    avatarUrl: "",
    createdAt: toIsoString("2026-03-09 00:26:35.710"),
    updatedAt: toIsoString("2026-03-09 00:26:35.710"),
    deletedAt: null
  });
});

test("workspacesRepository.insert falls back to slug lookup on duplicate workspace slug", async () => {
  const existingRow = {
    id: 12,
    slug: "shared-workspace",
    name: "Shared Workspace",
    owner_user_id: 9,
    is_personal: 0,
    avatar_url: "",
    created_at: "2026-03-09 00:26:35.710",
    updated_at: "2026-03-09 00:26:35.710",
    deleted_at: null
  };
  const { knex } = createWorkspacesKnexStub({
    rowBySlug: new Map([["shared-workspace", existingRow]]),
    insertError: { code: "ER_DUP_ENTRY" }
  });
  const repository = createRepository(knex);

  const inserted = await repository.insert({
    slug: "shared-workspace",
    name: "Shared Workspace",
    ownerUserId: "9"
  });

  assert.equal(inserted?.id, "12");
  assert.equal(inserted?.slug, "shared-workspace");
});

test("workspacesRepository.listForUserId keeps membership-specific fields while normalizing workspace fields", async () => {
  const { knex } = createWorkspacesKnexStub({
    membershipRows: [
      {
        id: 7,
        slug: "tonymobily3",
        name: "TonyMobily3",
        owner_user_id: 9,
        is_personal: 1,
        avatar_url: "",
        created_at: "2026-03-09 00:26:35.710",
        updated_at: "2026-03-10 00:26:35.710",
        deleted_at: null,
        role_sid: "owner",
        membership_status: "active"
      }
    ]
  });
  const repository = createRepository(knex);

  const rows = await repository.listForUserId("9");

  assert.deepEqual(rows, [
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
    }
  ]);
});
