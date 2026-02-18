import assert from "node:assert/strict";
import test from "node:test";

import { __testables as workspacesTestables } from "../repositories/workspacesRepository.js";
import { __testables as workspaceSettingsTestables } from "../repositories/workspaceSettingsRepository.js";
import { __testables as workspaceMembershipsTestables } from "../repositories/workspaceMembershipsRepository.js";
import { __testables as workspaceInvitesTestables } from "../repositories/workspaceInvitesRepository.js";

function createKnexStub(options = {}) {
  const firstQueue = Array.isArray(options.firstQueue) ? [...options.firstQueue] : [];
  const listQueue = Array.isArray(options.listQueue) ? [...options.listQueue] : [];
  const insertQueue = Array.isArray(options.insertQueue) ? [...options.insertQueue] : [];
  const updateQueue = Array.isArray(options.updateQueue) ? [...options.updateQueue] : [];

  const state = {
    tableCalls: [],
    wheres: [],
    andWheres: [],
    whereIns: [],
    joins: [],
    selects: [],
    orderBys: [],
    inserts: [],
    updates: []
  };

  function consume(queue, fallback) {
    return queue.length > 0 ? queue.shift() : fallback;
  }

  function createQuery(table) {
    const query = {
      where(...args) {
        state.wheres.push([table, ...args]);
        return query;
      },
      andWhere(...args) {
        state.andWheres.push([table, ...args]);
        return query;
      },
      whereIn(...args) {
        state.whereIns.push([table, ...args]);
        return query;
      },
      innerJoin(...args) {
        state.joins.push(["inner", table, ...args]);
        return query;
      },
      leftJoin(...args) {
        state.joins.push(["left", table, ...args]);
        return query;
      },
      select(...args) {
        state.selects.push([table, ...args]);
        return query;
      },
      orderBy(...args) {
        state.orderBys.push([table, ...args]);
        return query;
      },
      async first() {
        return consume(firstQueue, undefined);
      },
      async insert(payload) {
        state.inserts.push([table, payload]);
        return [consume(insertQueue, 1)];
      },
      async update(payload) {
        state.updates.push([table, payload]);
        return consume(updateQueue, 1);
      },
      then(resolve, reject) {
        return Promise.resolve(consume(listQueue, [])).then(resolve, reject);
      }
    };

    return query;
  }

  function dbClient(table) {
    state.tableCalls.push(table);
    return createQuery(table);
  }

  return {
    dbClient,
    state
  };
}

function workspaceRow(overrides = {}) {
  return {
    id: 11,
    slug: "acme",
    name: "Acme",
    color: "#123456",
    avatar_url: "https://example.com/acme.png",
    owner_user_id: 5,
    is_personal: 0,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides
  };
}

function workspaceSettingsRow(overrides = {}) {
  return {
    workspace_id: 11,
    invites_enabled: 1,
    features_json: JSON.stringify({ featureA: true }),
    policy_json: JSON.stringify({ defaultMode: "pv" }),
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides
  };
}

function membershipRow(overrides = {}) {
  return {
    id: 21,
    workspace_id: 11,
    user_id: 5,
    role_id: "member",
    status: "active",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides
  };
}

function inviteRow(overrides = {}) {
  return {
    id: 31,
    workspace_id: 11,
    email: "invitee@example.com",
    role_id: "member",
    token_hash: "hash-1",
    invited_by_user_id: 5,
    expires_at: "2030-01-01T00:00:00.000Z",
    status: "pending",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    invited_by_display_name: "Tony",
    invited_by_email: "tony@example.com",
    workspace_slug: "acme",
    workspace_name: "Acme",
    workspace_color: "#123456",
    workspace_avatar_url: "https://example.com/acme.png",
    ...overrides
  };
}

test("workspaces repository maps rows and executes find/insert/update/list flows", async () => {
  assert.throws(() => workspacesTestables.mapWorkspaceRowRequired(null), /expected a row object/);
  assert.equal(workspacesTestables.mapWorkspaceRowNullable(null), null);

  const mapped = workspacesTestables.mapWorkspaceRowRequired(workspaceRow({ color: "invalid", avatar_url: null }));
  assert.equal(mapped.color, "#0F6B54");
  assert.equal(mapped.avatarUrl, "");

  const stub = createKnexStub({
    firstQueue: [
      workspaceRow({ id: 1 }),
      workspaceRow({ id: 2 }),
      workspaceRow({ id: 3 }),
      workspaceRow({ id: 4 }),
      workspaceRow({ id: 5 }),
      workspaceRow({ id: 6 })
    ],
    listQueue: [
      [
        workspaceRow({
          id: 9,
          role_id: "admin",
          status: "active"
        })
      ]
    ],
    insertQueue: [44]
  });
  const repo = workspacesTestables.createWorkspacesRepository(stub.dbClient);

  const foundById = await repo.findById(1);
  assert.equal(foundById.id, 1);
  const foundBySlug = await repo.findBySlug("acme");
  assert.equal(foundBySlug.id, 2);
  const foundPersonal = await repo.findPersonalByOwnerUserId(5);
  assert.equal(foundPersonal.id, 3);

  const inserted = await repo.insert({
    slug: "new-workspace",
    name: "New Workspace",
    color: "#ABCDEF",
    avatarUrl: "",
    ownerUserId: 5,
    isPersonal: false
  });
  assert.equal(inserted.id, 4);
  assert.equal(stub.state.inserts[0][1].color, "#ABCDEF");

  const updated = await repo.updateById(44, {
    name: "Renamed Workspace",
    avatarUrl: "https://example.com/new.png",
    color: "invalid"
  });
  assert.equal(updated.id, 5);
  assert.equal(stub.state.updates.length > 0, true);
  assert.equal(stub.state.updates[0][1].color, "#0F6B54");

  const unchanged = await repo.updateById(44, {});
  assert.equal(unchanged.id, 6);

  const listed = await repo.listByUserId(5);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].roleId, "admin");
  assert.equal(listed[0].membershipStatus, "active");

  const txResult = await repo.transaction(async (trxClient) => {
    assert.equal(typeof trxClient, "function");
    return "ok";
  });
  assert.equal(txResult, "ok");
});

test("workspace settings repository parses JSON and supports find/ensure/update branches", async () => {
  assert.throws(() => workspaceSettingsTestables.mapWorkspaceSettingsRowRequired(null), /expected a row object/);
  assert.equal(workspaceSettingsTestables.mapWorkspaceSettingsRowNullable(null), null);
  assert.deepEqual(workspaceSettingsTestables.parseJsonValue("", { fallback: true }), { fallback: true });
  assert.deepEqual(workspaceSettingsTestables.parseJsonValue({ a: 1 }), { a: 1 });
  assert.deepEqual(workspaceSettingsTestables.parseJsonValue("{invalid"), {});

  const mapped = workspaceSettingsTestables.mapWorkspaceSettingsRowRequired(
    workspaceSettingsRow({
      features_json: "{invalid",
      policy_json: null
    })
  );
  assert.deepEqual(mapped.features, {});
  assert.deepEqual(mapped.policy, {});

  const existingStub = createKnexStub({
    firstQueue: [workspaceSettingsRow({ workspace_id: 1 })]
  });
  const existingRepo = workspaceSettingsTestables.createWorkspaceSettingsRepository(existingStub.dbClient);
  const existing = await existingRepo.ensureForWorkspaceId(1, { invitesEnabled: true });
  assert.equal(existing.workspaceId, 1);
  assert.equal(existingStub.state.inserts.length, 0);

  const createStub = createKnexStub({
    firstQueue: [
      undefined,
      workspaceSettingsRow({ workspace_id: 2 }),
      workspaceSettingsRow({ workspace_id: 2 }),
      workspaceSettingsRow({ workspace_id: 2 })
    ]
  });
  const createRepo = workspaceSettingsTestables.createWorkspaceSettingsRepository(createStub.dbClient);
  const ensured = await createRepo.ensureForWorkspaceId(2, {
    invitesEnabled: true,
    features: { app: true },
    policy: { defaultMode: "pv" }
  });
  assert.equal(ensured.workspaceId, 2);
  assert.equal(createStub.state.inserts.length, 1);

  const updated = await createRepo.updateByWorkspaceId(2, {
    invitesEnabled: false,
    features: { app: false },
    policy: { defaultMode: "fv" }
  });
  assert.equal(updated.workspaceId, 2);
  assert.equal(createStub.state.updates.length > 0, true);

  const unchanged = await createRepo.updateByWorkspaceId(2, {});
  assert.equal(unchanged.workspaceId, 2);

  const batchStub = createKnexStub({
    listQueue: [[workspaceSettingsRow({ workspace_id: 7 }), workspaceSettingsRow({ workspace_id: 8 })]]
  });
  const batchRepo = workspaceSettingsTestables.createWorkspaceSettingsRepository(batchStub.dbClient);
  const batched = await batchRepo.findByWorkspaceIds([7, 8, 7, null, -1]);
  assert.equal(batched.length, 2);
  assert.deepEqual(batchStub.state.whereIns[0], ["workspace_settings", "workspace_id", [7, 8]]);

  const emptyBatch = await batchRepo.findByWorkspaceIds([]);
  assert.deepEqual(emptyBatch, []);
  assert.equal(batchStub.state.whereIns.length, 1);
});

test("workspace memberships repository supports mapping and membership lifecycle operations", async () => {
  assert.throws(() => workspaceMembershipsTestables.mapMembershipRowRequired(null), /expected a row object/);
  assert.equal(workspaceMembershipsTestables.mapMembershipRowNullable(null), null);

  const mapped = workspaceMembershipsTestables.mapMembershipRowRequired(membershipRow());
  assert.equal(mapped.workspaceId, 11);
  assert.equal(mapped.roleId, "member");

  const stub = createKnexStub({
    firstQueue: [
      membershipRow({ id: 1 }),
      membershipRow({ id: 2 }),
      membershipRow({ id: 3 }),
      membershipRow({ id: 4 }),
      undefined,
      membershipRow({ id: 5 }),
      membershipRow({ id: 6 }),
      membershipRow({ id: 6, role_id: "admin", status: "active" })
    ],
    listQueue: [
      [membershipRow({ id: 11 })],
      [membershipRow({ id: 13, workspace_id: 12, status: "pending" })],
      [
        {
          ...membershipRow({ id: 12 }),
          user_email: "user@example.com",
          user_display_name: "User"
        }
      ]
    ],
    insertQueue: [22, 23]
  });
  const repo = workspaceMembershipsTestables.createWorkspaceMembershipsRepository(stub.dbClient);

  const found = await repo.findByWorkspaceIdAndUserId(11, 5);
  assert.equal(found.id, 1);

  const inserted = await repo.insert({
    workspaceId: 11,
    userId: 8,
    roleId: "member",
    status: "active"
  });
  assert.equal(inserted.id, 2);

  const ownerExisting = await repo.ensureOwnerMembership(11, 5);
  assert.equal(ownerExisting.id, 3);

  const byUser = await repo.listByUserId(5);
  assert.equal(byUser.length, 1);

  const byUserAndWorkspaceIds = await repo.listByUserIdAndWorkspaceIds(5, [11, 12, 11, "invalid"]);
  assert.equal(byUserAndWorkspaceIds.length, 1);
  assert.equal(byUserAndWorkspaceIds[0].id, 13);
  assert.deepEqual(stub.state.whereIns[0], ["workspace_memberships", "workspace_id", [11, 12]]);

  const noWorkspaceIds = await repo.listByUserIdAndWorkspaceIds(5, []);
  assert.deepEqual(noWorkspaceIds, []);

  const activeByWorkspace = await repo.listActiveByWorkspaceId(11);
  assert.equal(activeByWorkspace.length, 1);
  assert.equal(activeByWorkspace[0].user.email, "user@example.com");

  const roleUpdated = await repo.updateRoleByWorkspaceIdAndUserId(11, 5, "admin");
  assert.equal(roleUpdated.id, 4);

  const ensuredActiveInserted = await repo.ensureActiveByWorkspaceIdAndUserId(11, 9, "member");
  assert.equal(ensuredActiveInserted.id, 5);

  const ensuredActiveUpdated = await repo.ensureActiveByWorkspaceIdAndUserId(11, 5, "admin");
  assert.equal(ensuredActiveUpdated.id, 6);
});

test("workspace invites repository handles mapping, find/list, and status transitions", async () => {
  assert.throws(() => workspaceInvitesTestables.mapWorkspaceInviteRowRequired(null), /expected a row object/);
  assert.equal(workspaceInvitesTestables.mapWorkspaceInviteRowNullable(null), null);
  assert.equal(workspaceInvitesTestables.normalizeEmail(" User@Example.com "), "user@example.com");
  assert.equal(workspaceInvitesTestables.isMysqlDuplicateEntryError({ code: "ER_DUP_ENTRY" }), true);
  assert.equal(workspaceInvitesTestables.isMysqlDuplicateEntryError({ code: "OTHER" }), false);

  const mapped = workspaceInvitesTestables.mapWorkspaceInviteRowRequired(
    inviteRow({
      invited_by_display_name: null,
      invited_by_email: null,
      workspace_slug: null,
      workspace_name: null,
      workspace_color: null,
      workspace_avatar_url: null
    })
  );
  assert.equal(mapped.invitedBy, null);
  assert.equal(mapped.workspace, null);

  const mappedFallbacks = workspaceInvitesTestables.mapWorkspaceInviteRowRequired(
    inviteRow({
      email: "",
      role_id: "",
      token_hash: "",
      invited_by_user_id: null,
      status: "",
      invited_by_display_name: null,
      invited_by_email: "",
      workspace_slug: null,
      workspace_name: null,
      workspace_color: "bad-color",
      workspace_avatar_url: null
    })
  );
  assert.equal(mappedFallbacks.email, "");
  assert.equal(mappedFallbacks.roleId, "");
  assert.equal(mappedFallbacks.tokenHash, "");
  assert.equal(mappedFallbacks.invitedByUserId, null);
  assert.equal(mappedFallbacks.status, "");
  assert.deepEqual(mappedFallbacks.invitedBy, {
    displayName: "",
    email: ""
  });
  assert.deepEqual(mappedFallbacks.workspace, {
    id: 11,
    slug: "",
    name: "",
    color: "#0F6B54",
    avatarUrl: ""
  });

  const mappedNullWorkspaceColor = workspaceInvitesTestables.mapWorkspaceInviteRowRequired(
    inviteRow({
      workspace_slug: "",
      workspace_name: "",
      workspace_color: null,
      workspace_avatar_url: null
    })
  );
  assert.equal(mappedNullWorkspaceColor.workspace.color, "#0F6B54");

  const mappedEmptyInviterStrings = workspaceInvitesTestables.mapWorkspaceInviteRowRequired(
    inviteRow({
      invited_by_display_name: "",
      invited_by_email: ""
    })
  );
  assert.deepEqual(mappedEmptyInviterStrings.invitedBy, {
    displayName: "",
    email: ""
  });

  const stub = createKnexStub({
    firstQueue: [
      inviteRow({ id: 1 }),
      inviteRow({ id: 2 }),
      inviteRow({ id: 3 }),
      inviteRow({ id: 4 }),
      inviteRow({ id: 5 }),
      inviteRow({ id: 6 }),
      inviteRow({ id: 7 }),
      inviteRow({ id: 8 }),
      inviteRow({ id: 9 }),
      inviteRow({ id: 10 }),
      inviteRow({ id: 11 })
    ],
    listQueue: [[inviteRow({ id: 11 })], [inviteRow({ id: 12 })], [inviteRow({ id: 13 })]],
    insertQueue: [41],
    updateQueue: [1, 1, 1, 1, 3, 2]
  });
  const repo = workspaceInvitesTestables.createWorkspaceInvitesRepository(stub.dbClient);

  const inserted = await repo.insert({
    workspaceId: 11,
    email: "INVITEE@EXAMPLE.COM",
    roleId: "member",
    tokenHash: "hash",
    invitedByUserId: 5,
    expiresAt: "2030-01-01T00:00:00.000Z",
    status: "pending"
  });
  assert.equal(inserted.id, 1);
  assert.equal(stub.state.inserts[0][1].email, "invitee@example.com");

  const pendingByWorkspace = await repo.listPendingByWorkspaceId(11);
  assert.equal(pendingByWorkspace.length, 1);

  const pendingWithWorkspace = await repo.listPendingByWorkspaceIdWithWorkspace(11);
  assert.equal(pendingWithWorkspace.length, 1);

  assert.deepEqual(await repo.listPendingByEmail(""), []);
  const pendingByEmail = await repo.listPendingByEmail("invitee@example.com");
  assert.equal(pendingByEmail.length, 1);

  const foundById = await repo.findById(2);
  assert.equal(foundById.id, 2);

  assert.equal(await repo.findPendingByWorkspaceIdAndEmail(11, ""), null);
  const pendingByWorkspaceAndEmail = await repo.findPendingByWorkspaceIdAndEmail(11, "invitee@example.com");
  assert.equal(pendingByWorkspaceAndEmail.id, 3);

  const pendingByIdForWorkspace = await repo.findPendingByIdForWorkspace(4, 11);
  assert.equal(pendingByIdForWorkspace.id, 4);

  const updatedStatus = await repo.updateStatusById(6, "accepted");
  assert.equal(updatedStatus.id, 5);
  const revoked = await repo.revokeById(7);
  assert.equal(revoked.id, 6);
  const accepted = await repo.markAcceptedById(8);
  assert.equal(accepted.id, 7);

  const insertedDefaults = await repo.insert({
    workspaceId: 11,
    email: " Lower@Example.com ",
    roleId: "",
    tokenHash: "",
    invitedByUserId: 0,
    expiresAt: "2030-01-01T00:00:00.000Z",
    status: ""
  });
  assert.equal(insertedDefaults.id, 8);
  assert.equal(stub.state.inserts[1][1].role_id, "");
  assert.equal(stub.state.inserts[1][1].token_hash, "");
  assert.equal(stub.state.inserts[1][1].invited_by_user_id, null);
  assert.equal(stub.state.inserts[1][1].status, "pending");

  const updatedDefaultStatus = await repo.updateStatusById(10);
  assert.equal(updatedDefaultStatus.id, 9);
  assert.equal(stub.state.updates.at(-1)[1].status, "");

  assert.equal(await repo.findPendingByTokenHash(""), null);
  const pendingByTokenHash = await repo.findPendingByTokenHash("hash");
  assert.equal(pendingByTokenHash.id, 10);

  assert.equal(await repo.expirePendingByWorkspaceIdAndEmail(11, ""), 0);
  const expiredForWorkspaceAndEmail = await repo.expirePendingByWorkspaceIdAndEmail(11, " INVITEE@EXAMPLE.COM ");
  assert.equal(expiredForWorkspaceAndEmail, 3);

  const expiredCount = await repo.markExpiredPendingInvites();
  assert.equal(expiredCount, 2);

  const txResult = await repo.transaction(async (trxClient) => {
    assert.equal(typeof trxClient, "function");
    return "ok";
  });
  assert.equal(txResult, "ok");

  const zeroUpdateStub = createKnexStub({
    updateQueue: [0]
  });
  const zeroUpdateRepo = workspaceInvitesTestables.createWorkspaceInvitesRepository(zeroUpdateStub.dbClient);
  const zeroExpiredCount = await zeroUpdateRepo.markExpiredPendingInvites();
  assert.equal(zeroExpiredCount, 0);
});
