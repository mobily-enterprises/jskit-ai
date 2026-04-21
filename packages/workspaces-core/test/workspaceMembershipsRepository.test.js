import assert from "node:assert/strict";
import test from "node:test";
import { toIsoString } from "@jskit-ai/database-runtime/shared";
import { createRepository } from "../src/server/common/repositories/workspaceMembershipsRepository.js";

function createKnexStub({
  rowById = new Map(),
  rowByComposite = new Map(),
  memberSummaryRows = []
} = {}) {
  const state = {
    insertPayload: null,
    updatePayload: null
  };

  function buildMembershipsQuery(tableName) {
    if (tableName === "workspace_memberships as wm") {
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
          return Promise.resolve([...memberSummaryRows]);
        }
      };
    }

    const query = {
      criteriaList: [],
      select() {
        return this;
      },
      insert(payload) {
        state.insertPayload = payload;
        const insertedRow = rowById.get("1");
        if (insertedRow) {
          rowByComposite.set(`${payload.workspace_id}:${payload.user_id}`, insertedRow);
        }
        return Promise.resolve([1]);
      },
      where(criteria) {
        this.criteriaList.push(criteria);
        return this;
      },
      update(payload) {
        state.updatePayload = payload;
        const criteria = Object.assign({}, ...this.criteriaList);
        const existingRow = rowById.get(String(criteria.id));
        if (existingRow) {
          const updatedRow = {
            ...existingRow,
            ...payload
          };
          rowById.set(String(criteria.id), updatedRow);
          rowByComposite.set(`${updatedRow.workspace_id}:${updatedRow.user_id}`, updatedRow);
        }
        return Promise.resolve(1);
      },
      first() {
        const criteria = Object.assign({}, ...this.criteriaList);
        if (Object.hasOwn(criteria, "id")) {
          return Promise.resolve(rowById.get(String(criteria.id)) || null);
        }
        if (Object.hasOwn(criteria, "workspace_id") && Object.hasOwn(criteria, "user_id")) {
          return Promise.resolve(
            rowByComposite.get(`${criteria.workspace_id}:${criteria.user_id}`) || null
          );
        }
        return Promise.resolve(null);
      }
    };

    return query;
  }

  function knex(tableName) {
    if (tableName === "workspace_memberships" || tableName === "workspace_memberships as wm") {
      return buildMembershipsQuery(tableName);
    }
    throw new Error(`Unexpected table ${tableName}`);
  }

  knex.transaction = async (work) => work(knex);

  return { knex, state };
}

test("workspaceMembershipsRepository.findByWorkspaceIdAndUserId normalizes canonical membership rows via the internal resource", async () => {
  const membershipRow = {
    id: 11,
    workspace_id: 7,
    user_id: 9,
    role_sid: "owner",
    status: "active",
    created_at: "2026-03-09 00:26:35.710",
    updated_at: "2026-03-10 00:26:35.710"
  };
  const { knex } = createKnexStub({
    rowByComposite: new Map([["7:9", membershipRow]])
  });
  const repository = createRepository(knex);

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
    id: 11,
    workspace_id: 7,
    user_id: 9,
    role_sid: "member",
    status: "pending",
    created_at: "2026-03-09 00:26:35.710",
    updated_at: "2026-03-09 00:26:35.710"
  };
  const refreshedRow = {
    ...existingRow,
    role_sid: "owner",
    status: "active",
    updated_at: "2026-03-10 00:26:35.710"
  };
  const { knex, state } = createKnexStub({
    rowById: new Map([["11", refreshedRow]]),
    rowByComposite: new Map([["7:9", existingRow]])
  });
  const repository = createRepository(knex);

  const membership = await repository.ensureOwnerMembership("7", "9");

  assert.equal(state.updatePayload.role_sid, "owner");
  assert.equal(state.updatePayload.status, "active");
  assert.equal(typeof state.updatePayload.updated_at, "string");
  assert.deepEqual(membership, {
    id: "11",
    workspaceId: "7",
    userId: "9",
    roleSid: "owner",
    status: "active",
    createdAt: toIsoString("2026-03-09 00:26:35.710"),
    updatedAt: toIsoString(state.updatePayload.updated_at)
  });
});

test("workspaceMembershipsRepository.upsertMembership creates normalized memberships through the runtime create path", async () => {
  const createdRow = {
    id: 1,
    workspace_id: 7,
    user_id: 9,
    role_sid: "admin",
    status: "active",
    created_at: "2026-03-09 00:26:35.710",
    updated_at: "2026-03-09 00:26:35.710"
  };
  const { knex, state } = createKnexStub({
    rowById: new Map([["1", createdRow]]),
    rowByComposite: new Map()
  });
  const repository = createRepository(knex);

  await repository.upsertMembership("7", "9", {
    roleSid: "ADMIN",
    status: "ACTIVE"
  });

  assert.equal(state.insertPayload.workspace_id, "7");
  assert.equal(state.insertPayload.user_id, "9");
  assert.equal(state.insertPayload.role_sid, "admin");
  assert.equal(state.insertPayload.status, "active");
});

test("workspaceMembershipsRepository.listActiveByWorkspaceId keeps summary rows separate from the canonical membership resource", async () => {
  const { knex } = createKnexStub({
    memberSummaryRows: [
      {
        user_id: 9,
        role_sid: "owner",
        status: "active",
        display_name: "Chiara",
        email: "CHIARA@example.com"
      }
    ]
  });
  const repository = createRepository(knex);

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
