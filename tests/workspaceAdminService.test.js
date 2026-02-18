import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../server/lib/errors.js";
import { createService as createWorkspaceAdminService } from "../server/modules/workspace/admin.service.js";

function hexHash(character) {
  return String(character || "0").repeat(64);
}

function opaqueInviteToken(tokenHash) {
  return `inviteh_${String(tokenHash || "").toLowerCase()}`;
}

function createWorkspaceAdminFixture(overrides = {}) {
  const now = new Date();
  const futureIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const pastIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const state = {
    workspace: {
      id: 11,
      slug: "acme",
      name: "Acme",
      color: "#0F6B54",
      avatarUrl: "",
      ownerUserId: 5,
      isPersonal: false
    },
    settings: {
      workspaceId: 11,
      invitesEnabled: true,
      features: {
        surfaceAccess: {
          app: {
            denyEmails: ["blocked@example.com"],
            denyUserIds: [7]
          }
        }
      },
      policy: {
        defaultMode: "pv",
        defaultTiming: "due",
        defaultPaymentsPerYear: 4,
        defaultHistoryPageSize: 25
      }
    },
    memberships: [
      {
        id: 1,
        workspaceId: 11,
        userId: 5,
        roleId: "owner",
        status: "active",
        user: {
          email: "owner@example.com",
          displayName: "Owner"
        }
      },
      {
        id: 2,
        workspaceId: 11,
        userId: 9,
        roleId: "member",
        status: "active",
        user: {
          email: "member@example.com",
          displayName: "Member"
        }
      },
      {
        id: 3,
        workspaceId: 11,
        userId: 10,
        roleId: "member",
        status: "inactive",
        user: {
          email: "inactive@example.com",
          displayName: "Inactive"
        }
      }
    ],
    invites: [
      {
        id: 100,
        workspaceId: 11,
        email: "invitee@example.com",
        roleId: "member",
        tokenHash: hexHash("1"),
        invitedByUserId: 5,
        expiresAt: futureIso,
        status: "pending",
        invitedBy: {
          displayName: "Owner",
          email: "owner@example.com"
        },
        workspace: null
      },
      {
        id: 101,
        workspaceId: 11,
        email: "expired@example.com",
        roleId: "member",
        tokenHash: hexHash("2"),
        invitedByUserId: 5,
        expiresAt: pastIso,
        status: "pending",
        invitedBy: {
          displayName: "Owner",
          email: "owner@example.com"
        },
        workspace: null
      }
    ],
    profilesByEmail: {
      "member@example.com": {
        id: 9,
        email: "member@example.com",
        displayName: "Member"
      }
    },
    updatedLastActiveWorkspaceByUserId: new Map()
  };

  let nextInviteId = 200;
  const counters = {
    workspaceUpdates: 0,
    settingsUpdates: 0,
    inviteInserts: 0,
    inviteTargetedExpirations: 0,
    inviteTransactions: 0,
    findByWorkspaceIdAndUserId: 0,
    listByUserIdAndWorkspaceIds: 0
  };

  function cloneWorkspace() {
    return {
      ...state.workspace
    };
  }

  function cloneSettings() {
    return {
      ...state.settings,
      features: JSON.parse(JSON.stringify(state.settings.features || {})),
      policy: JSON.parse(JSON.stringify(state.settings.policy || {}))
    };
  }

  function toInviteWithWorkspace(invite) {
    return {
      ...invite,
      workspace: {
        id: state.workspace.id,
        slug: state.workspace.slug,
        name: state.workspace.name,
        color: state.workspace.color,
        avatarUrl: state.workspace.avatarUrl
      }
    };
  }

  function isInvitePendingAndUnexpired(invite) {
    return invite.status === "pending" && String(invite.expiresAt || "") > new Date().toISOString();
  }

  const workspacesRepository = {
    async findById(id) {
      if (Number(id) !== Number(state.workspace.id)) {
        return null;
      }
      return cloneWorkspace();
    },
    async updateById(id, patch) {
      if (Number(id) !== Number(state.workspace.id)) {
        return null;
      }
      counters.workspaceUpdates += 1;
      state.workspace = {
        ...state.workspace,
        ...patch
      };
      return cloneWorkspace();
    }
  };

  const workspaceSettingsRepository = {
    async ensureForWorkspaceId(workspaceId, defaults = {}) {
      if (Number(workspaceId) !== Number(state.workspace.id)) {
        return null;
      }

      if (!state.settings) {
        state.settings = {
          workspaceId: Number(workspaceId),
          invitesEnabled: Boolean(defaults.invitesEnabled),
          features: defaults.features || {},
          policy: defaults.policy || {}
        };
      }

      return cloneSettings();
    },
    async updateByWorkspaceId(workspaceId, patch = {}) {
      if (Number(workspaceId) !== Number(state.workspace.id)) {
        return null;
      }
      counters.settingsUpdates += 1;
      state.settings = {
        ...state.settings,
        ...patch,
        features: patch.features ? JSON.parse(JSON.stringify(patch.features)) : state.settings.features,
        policy: patch.policy ? JSON.parse(JSON.stringify(patch.policy)) : state.settings.policy
      };
      return cloneSettings();
    }
  };

  const workspaceMembershipsRepository = {
    async listActiveByWorkspaceId(workspaceId) {
      return state.memberships
        .filter(
          (membership) => Number(membership.workspaceId) === Number(workspaceId) && membership.status === "active"
        )
        .map((membership) => ({
          ...membership,
          user: {
            ...membership.user
          }
        }));
    },
    async findByWorkspaceIdAndUserId(workspaceId, userId) {
      counters.findByWorkspaceIdAndUserId += 1;
      const found = state.memberships.find(
        (membership) =>
          Number(membership.workspaceId) === Number(workspaceId) && Number(membership.userId) === Number(userId)
      );
      return found
        ? {
            ...found,
            user: {
              ...found.user
            }
          }
        : null;
    },
    async listByUserIdAndWorkspaceIds(userId, workspaceIds) {
      counters.listByUserIdAndWorkspaceIds += 1;
      const normalizedWorkspaceIds = Array.from(
        new Set(
          (Array.isArray(workspaceIds) ? workspaceIds : [])
            .map((workspaceId) => Number(workspaceId))
            .filter((workspaceId) => Number.isInteger(workspaceId) && workspaceId > 0)
        )
      );

      return state.memberships
        .filter(
          (membership) =>
            Number(membership.userId) === Number(userId) && normalizedWorkspaceIds.includes(Number(membership.workspaceId))
        )
        .map((membership) => ({
          ...membership,
          user: {
            ...membership.user
          }
        }));
    },
    async updateRoleByWorkspaceIdAndUserId(workspaceId, userId, roleId) {
      const index = state.memberships.findIndex(
        (membership) =>
          Number(membership.workspaceId) === Number(workspaceId) && Number(membership.userId) === Number(userId)
      );
      if (index >= 0) {
        state.memberships[index] = {
          ...state.memberships[index],
          roleId
        };
      }
      return state.memberships[index] || null;
    },
    async ensureActiveByWorkspaceIdAndUserId(workspaceId, userId, roleId) {
      const index = state.memberships.findIndex(
        (membership) =>
          Number(membership.workspaceId) === Number(workspaceId) && Number(membership.userId) === Number(userId)
      );
      if (index >= 0) {
        state.memberships[index] = {
          ...state.memberships[index],
          roleId,
          status: "active"
        };
        return state.memberships[index];
      }

      const nextMembership = {
        id: state.memberships.length + 1,
        workspaceId: Number(workspaceId),
        userId: Number(userId),
        roleId,
        status: "active",
        user: {
          email: "",
          displayName: ""
        }
      };
      state.memberships.push(nextMembership);
      return nextMembership;
    }
  };

  const workspaceInvitesRepository = {
    async transaction(callback) {
      counters.inviteTransactions += 1;
      return callback({});
    },
    async markExpiredPendingInvites() {
      const nowIso = new Date().toISOString();
      for (const invite of state.invites) {
        if (invite.status === "pending" && invite.expiresAt <= nowIso) {
          invite.status = "expired";
        }
      }
    },
    async expirePendingByWorkspaceIdAndEmail(workspaceId, email) {
      counters.inviteTargetedExpirations += 1;
      const nowIso = new Date().toISOString();
      const normalizedEmail = String(email || "")
        .trim()
        .toLowerCase();
      for (const invite of state.invites) {
        if (
          Number(invite.workspaceId) === Number(workspaceId) &&
          invite.status === "pending" &&
          String(invite.email || "").toLowerCase() === normalizedEmail &&
          invite.expiresAt <= nowIso
        ) {
          invite.status = "expired";
        }
      }
    },
    async listPendingByWorkspaceIdWithWorkspace(workspaceId) {
      return state.invites
        .filter(
          (invite) => Number(invite.workspaceId) === Number(workspaceId) && isInvitePendingAndUnexpired(invite)
        )
        .map((invite) => toInviteWithWorkspace(invite));
    },
    async findPendingByWorkspaceIdAndEmail(workspaceId, email) {
      return (
        state.invites.find(
          (invite) =>
            Number(invite.workspaceId) === Number(workspaceId) &&
            isInvitePendingAndUnexpired(invite) &&
            String(invite.email || "").toLowerCase() === String(email || "").toLowerCase()
        ) || null
      );
    },
    async insert(payload) {
      const normalizedEmail = String(payload.email || "")
        .trim()
        .toLowerCase();
      const duplicatePendingInvite = state.invites.find(
        (invite) =>
          Number(invite.workspaceId) === Number(payload.workspaceId) &&
          invite.status === "pending" &&
          String(invite.email || "").toLowerCase() === normalizedEmail
      );
      if (duplicatePendingInvite) {
        const error = new Error("duplicate pending invite");
        error.code = "ER_DUP_ENTRY";
        throw error;
      }

      counters.inviteInserts += 1;
      state.invites.push({
        id: nextInviteId++,
        workspace: null,
        invitedBy: {
          displayName: "Owner",
          email: "owner@example.com"
        },
        ...payload
      });
    },
    async findPendingByIdForWorkspace(inviteId, workspaceId) {
      const found = state.invites.find(
        (invite) =>
          Number(invite.id) === Number(inviteId) &&
          Number(invite.workspaceId) === Number(workspaceId) &&
          isInvitePendingAndUnexpired(invite)
      );
      return found ? toInviteWithWorkspace(found) : null;
    },
    async revokeById(inviteId) {
      const index = state.invites.findIndex((invite) => Number(invite.id) === Number(inviteId));
      if (index >= 0) {
        state.invites[index] = {
          ...state.invites[index],
          status: "revoked"
        };
      }
      return index >= 0 ? toInviteWithWorkspace(state.invites[index]) : null;
    },
    async listPendingByEmail(email) {
      const normalizedEmail = String(email || "")
        .trim()
        .toLowerCase();
      return state.invites
        .filter(
          (invite) => isInvitePendingAndUnexpired(invite) && String(invite.email || "").toLowerCase() === normalizedEmail
        )
        .map((invite) => toInviteWithWorkspace(invite));
    },
    async findPendingByTokenHash(tokenHash) {
      const normalizedTokenHash = String(tokenHash || "")
        .trim()
        .toLowerCase();
      if (!normalizedTokenHash) {
        return null;
      }

      const found = state.invites.find(
        (invite) => isInvitePendingAndUnexpired(invite) && String(invite.tokenHash || "").toLowerCase() === normalizedTokenHash
      );
      return found ? toInviteWithWorkspace(found) : null;
    },
    async markAcceptedById(inviteId) {
      const index = state.invites.findIndex((invite) => Number(invite.id) === Number(inviteId));
      if (index >= 0) {
        state.invites[index] = {
          ...state.invites[index],
          status: "accepted"
        };
      }
      return index >= 0 ? toInviteWithWorkspace(state.invites[index]) : null;
    }
  };

  const userProfilesRepository = {
    async findByEmail(email) {
      return state.profilesByEmail[String(email || "").toLowerCase()] || null;
    }
  };

  const userSettingsRepository = {
    async updateLastActiveWorkspaceId(userId, workspaceId) {
      state.updatedLastActiveWorkspaceByUserId.set(Number(userId), Number(workspaceId));
    }
  };

  const appConfig = {
    features: {
      workspaceInvites: true
    },
    ...(overrides.appConfig || {})
  };
  const rbacManifest = {
    defaultInviteRole: "member",
    collaborationEnabled: true,
    roles: {
      owner: {
        assignable: false,
        permissions: ["*"]
      },
      admin: {
        assignable: true,
        permissions: ["workspace.settings.update", "workspace.members.manage"]
      },
      member: {
        assignable: true,
        permissions: ["history.read"]
      }
    },
    ...(overrides.rbacManifest || {})
  };

  const service = createWorkspaceAdminService({
    appConfig,
    rbacManifest,
    workspacesRepository,
    workspaceSettingsRepository,
    workspaceMembershipsRepository,
    workspaceInvitesRepository,
    userProfilesRepository,
    userSettingsRepository
  });

  return {
    state,
    counters,
    service
  };
}

test("workspace admin service validates constructor dependencies", () => {
  assert.throws(() => createWorkspaceAdminService({}), /repositories are required/);
});

test("workspace admin service reads and updates workspace settings with role catalog", async () => {
  const { service, state, counters } = createWorkspaceAdminFixture();

  const catalog = service.getRoleCatalog();
  assert.equal(catalog.collaborationEnabled, true);
  assert.equal(catalog.defaultInviteRole, "member");
  assert.deepEqual(catalog.assignableRoleIds, ["admin", "member"]);

  const responseWithoutDenyLists = await service.getWorkspaceSettings(
    {
      id: 11
    },
    {
      includeAppSurfaceDenyLists: false
    }
  );
  assert.equal(responseWithoutDenyLists.workspace.slug, "acme");
  assert.equal(responseWithoutDenyLists.settings.appDenyEmails, undefined);

  const responseWithDenyLists = await service.getWorkspaceSettings(
    {
      id: 11
    },
    {
      includeAppSurfaceDenyLists: true
    }
  );
  assert.deepEqual(responseWithDenyLists.settings.appDenyEmails, ["blocked@example.com"]);
  assert.deepEqual(responseWithDenyLists.settings.appDenyUserIds, [7]);

  await assert.rejects(
    () => service.getWorkspaceSettings({ id: 0 }),
    (error) => error instanceof AppError && error.statusCode === 409
  );
  await assert.rejects(
    () => service.getWorkspaceSettings({ id: 99 }),
    (error) => error instanceof AppError && error.statusCode === 404
  );

  await assert.rejects(
    () =>
      service.updateWorkspaceSettings(
        { id: 11 },
        {
          name: "",
          color: "bad-color"
        }
      ),
    (error) =>
      error instanceof AppError &&
      error.statusCode === 400 &&
      Boolean(error.details?.fieldErrors?.name) &&
      Boolean(error.details?.fieldErrors?.color)
  );

  const updated = await service.updateWorkspaceSettings(
    {
      id: 11
    },
    {
      name: "Acme Prime",
      avatarUrl: "https://example.com/new.png",
      color: "#112233",
      invitesEnabled: false,
      defaultMode: "fv",
      defaultTiming: "ordinary",
      defaultPaymentsPerYear: 12,
      defaultHistoryPageSize: 10,
      appDenyEmails: ["one@example.com"],
      appDenyUserIds: [2]
    }
  );

  assert.equal(counters.workspaceUpdates > 0, true);
  assert.equal(counters.settingsUpdates > 0, true);
  assert.equal(state.workspace.name, "Acme Prime");
  assert.equal(state.workspace.color, "#112233");
  assert.equal(updated.workspace.name, "Acme Prime");
  assert.equal(updated.settings.invitesEnabled, false);
  assert.deepEqual(updated.settings.appDenyEmails, ["one@example.com"]);
  assert.deepEqual(updated.settings.appDenyUserIds, [2]);
  assert.equal(updated.roleCatalog.assignableRoleIds.includes("admin"), true);
});

test("workspace admin service manages members, invites, and pending invite responses", async () => {
  const { service, state, counters } = createWorkspaceAdminFixture();

  const members = await service.listMembers({ id: 11 });
  assert.equal(members.members.length, 2);
  assert.equal(members.members.find((member) => member.userId === 5).isOwner, true);

  await assert.rejects(
    () => service.updateMemberRole({ id: 11 }, { memberUserId: "", roleId: "member" }),
    (error) => error instanceof AppError && error.statusCode === 400
  );
  await assert.rejects(
    () => service.updateMemberRole({ id: 11 }, { memberUserId: 9, roleId: "viewer" }),
    (error) => error instanceof AppError && error.statusCode === 400
  );
  await assert.rejects(
    () => service.updateMemberRole({ id: 11 }, { memberUserId: 404, roleId: "member" }),
    (error) => error instanceof AppError && error.statusCode === 404
  );
  await assert.rejects(
    () => service.updateMemberRole({ id: 11 }, { memberUserId: 5, roleId: "member" }),
    (error) => error instanceof AppError && error.statusCode === 409
  );

  const updatedMembers = await service.updateMemberRole({ id: 11 }, { memberUserId: 9, roleId: "admin" });
  assert.equal(updatedMembers.members.find((member) => member.userId === 9).roleId, "admin");

  const invites = await service.listInvites({ id: 11 });
  assert.equal(invites.invites.length, 1);
  assert.equal(invites.invites[0].email, "invitee@example.com");

  const invitesDisabledFixture = createWorkspaceAdminFixture({
    appConfig: {
      features: {
        workspaceInvites: false
      }
    }
  });
  await assert.rejects(
    () => invitesDisabledFixture.service.createInvite({ id: 11 }, { id: 5 }, { email: "x@example.com" }),
    (error) => error instanceof AppError && error.statusCode === 403
  );

  await assert.rejects(
    () => service.createInvite({ id: 11 }, { id: 5 }, { email: "" }),
    (error) => error instanceof AppError && error.statusCode === 400
  );
  await assert.rejects(
    () => service.createInvite({ id: 11 }, { id: 5 }, { email: "member@example.com", roleId: "member" }),
    (error) => error instanceof AppError && error.statusCode === 409
  );
  await assert.rejects(
    () => service.createInvite({ id: 11 }, { id: 5 }, { email: "invitee@example.com", roleId: "member" }),
    (error) => error instanceof AppError && error.statusCode === 409
  );

  const createdInviteResponse = await service.createInvite(
    { id: 11 },
    { id: 5 },
    { email: "new@example.com", roleId: "member" }
  );
  assert.equal(counters.inviteInserts, 1);
  assert.equal(counters.inviteTransactions >= 1, true);
  assert.equal(counters.inviteTargetedExpirations >= 1, true);
  assert.equal(
    createdInviteResponse.invites.some((invite) => invite.email === "new@example.com"),
    true
  );
  assert.equal(typeof createdInviteResponse.createdInvite?.token, "string");
  assert.equal(createdInviteResponse.createdInvite.token.length > 0, true);

  const recreatedExpiredInviteResponse = await service.createInvite(
    { id: 11 },
    { id: 5 },
    { email: "expired@example.com", roleId: "member" }
  );
  assert.equal(
    recreatedExpiredInviteResponse.invites.some((invite) => invite.email === "expired@example.com"),
    true
  );

  const tokenInviteResponse = await service.createInvite(
    { id: 11 },
    { id: 5 },
    { email: "token@example.com", roleId: "member" }
  );
  assert.equal(typeof tokenInviteResponse.createdInvite?.token, "string");
  assert.equal(tokenInviteResponse.createdInvite.token.length > 0, true);

  await assert.rejects(
    () => service.revokeInvite({ id: 11 }, "invalid"),
    (error) => error instanceof AppError && error.statusCode === 400
  );
  await assert.rejects(
    () => service.revokeInvite({ id: 11 }, 9999),
    (error) => error instanceof AppError && error.statusCode === 404
  );

  const revokedResponse = await service.revokeInvite({ id: 11 }, 100);
  assert.equal(
    revokedResponse.invites.some((invite) => invite.id === 100),
    false
  );

  assert.deepEqual(await service.listPendingInvitesForUser({ email: "", id: 5 }), []);

  const pendingForEmailOnly = await service.listPendingInvitesForUser({
    email: "new@example.com",
    id: null
  });
  assert.equal(pendingForEmailOnly.length, 1);
  assert.equal(typeof pendingForEmailOnly[0].token, "string");
  assert.equal(pendingForEmailOnly[0].token.length > 0, true);

  const pendingFilteredByMembership = await service.listPendingInvitesForUser({
    email: "member@example.com",
    id: 9
  });
  assert.equal(pendingFilteredByMembership.length, 0);

  await assert.rejects(
    () =>
      service.respondToPendingInviteByToken({
        user: { id: 0, email: "" },
        inviteToken: tokenInviteResponse.createdInvite.token,
        decision: "accept"
      }),
    (error) => error instanceof AppError && error.statusCode === 401
  );
  await assert.rejects(
    () =>
      service.respondToPendingInviteByToken({
        user: { id: 5, email: "owner@example.com" },
        inviteToken: tokenInviteResponse.createdInvite.token,
        decision: "bad"
      }),
    (error) => error instanceof AppError && error.statusCode === 400
  );
  await assert.rejects(
    () =>
      service.respondToPendingInviteByToken({
        user: { id: 5, email: "owner@example.com" },
        inviteToken: "missing-token",
        decision: "accept"
      }),
    (error) => error instanceof AppError && error.statusCode === 404
  );
  await assert.rejects(
    () =>
      service.respondToPendingInviteByToken({
        user: { id: 0, email: "" },
        inviteToken: tokenInviteResponse.createdInvite.token,
        decision: "accept"
      }),
    (error) => error instanceof AppError && error.statusCode === 401
  );
  await assert.rejects(
    () =>
      service.respondToPendingInviteByToken({
        user: { id: 55, email: "token@example.com" },
        inviteToken: "",
        decision: "accept"
      }),
    (error) => error instanceof AppError && error.statusCode === 400
  );
  await assert.rejects(
    () =>
      service.respondToPendingInviteByToken({
        user: { id: 55, email: "another@example.com" },
        inviteToken: tokenInviteResponse.createdInvite.token,
        decision: "accept"
      }),
    (error) => error instanceof AppError && error.statusCode === 403
  );
  await assert.rejects(
    () =>
      service.respondToPendingInviteByToken({
        user: { id: 55, email: "token@example.com" },
        inviteToken: "missing-token",
        decision: "accept"
      }),
    (error) => error instanceof AppError && error.statusCode === 404
  );

  const acceptedByToken = await service.respondToPendingInviteByToken({
    user: {
      id: 55,
      email: "token@example.com"
    },
    inviteToken: tokenInviteResponse.createdInvite.token,
    decision: "accept"
  });
  assert.equal(acceptedByToken.decision, "accepted");
  assert.equal(acceptedByToken.workspace.slug, "acme");
  assert.equal(state.updatedLastActiveWorkspaceByUserId.get(55), 11);

  state.invites.push({
    id: 300,
    workspaceId: 11,
    email: "refuse@example.com",
    roleId: "member",
    tokenHash: hexHash("3"),
    invitedByUserId: 5,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    status: "pending",
    invitedBy: {
      displayName: "Owner",
      email: "owner@example.com"
    },
    workspace: null
  });
  const refused = await service.respondToPendingInviteByToken({
    user: {
      id: 40,
      email: "refuse@example.com"
    },
    inviteToken: opaqueInviteToken(hexHash("3")),
    decision: "refuse"
  });
  assert.equal(refused.decision, "refused");

  state.invites.push({
    id: 301,
    workspaceId: 11,
    email: "accept@example.com",
    roleId: "admin",
    tokenHash: hexHash("4"),
    invitedByUserId: 5,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    status: "pending",
    invitedBy: {
      displayName: "Owner",
      email: "owner@example.com"
    },
    workspace: null
  });
  const accepted = await service.respondToPendingInviteByToken({
    user: {
      id: 41,
      email: "accept@example.com"
    },
    inviteToken: opaqueInviteToken(hexHash("4")),
    decision: "accept"
  });
  assert.equal(accepted.decision, "accepted");
  assert.equal(accepted.workspace.slug, "acme");
  assert.equal(state.updatedLastActiveWorkspaceByUserId.get(41), 11);
  assert.equal(
    state.memberships.some((membership) => membership.userId === 41 && membership.status === "active"),
    true
  );
});

test("workspace admin service pending invite listing uses O(1) membership lookups for large invite sets", async () => {
  const { service, state, counters } = createWorkspaceAdminFixture();
  const email = "bulk@example.com";
  const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  for (let index = 0; index < 100; index += 1) {
    state.invites.push({
      id: 9000 + index,
      workspaceId: 2000 + index,
      email,
      roleId: "member",
      tokenHash: String(9000 + index).padStart(64, "0"),
      invitedByUserId: 5,
      expiresAt: futureIso,
      status: "pending",
      invitedBy: {
        displayName: "Owner",
        email: "owner@example.com"
      },
      workspace: null
    });
  }

  state.memberships.push({
    id: 999,
    workspaceId: 2005,
    userId: 77,
    roleId: "member",
    status: "active",
    user: {
      email: "bulk@example.com",
      displayName: "Bulk User"
    }
  });

  const pending = await service.listPendingInvitesForUser({
    email,
    id: 77
  });

  assert.equal(pending.length, 99);
  assert.equal(counters.listByUserIdAndWorkspaceIds, 1);
  assert.equal(counters.findByWorkspaceIdAndUserId, 0);
});

test("workspace admin service rolls back workspace update when settings write fails", async () => {
  const state = {
    workspace: {
      id: 11,
      slug: "acme",
      name: "Acme",
      color: "#0F6B54",
      avatarUrl: "",
      ownerUserId: 5,
      isPersonal: false
    },
    settings: {
      workspaceId: 11,
      invitesEnabled: true,
      features: {},
      policy: {
        defaultMode: "fv",
        defaultTiming: "ordinary",
        defaultPaymentsPerYear: 12,
        defaultHistoryPageSize: 10
      }
    }
  };

  const workspacesRepository = {
    async findById(id) {
      if (Number(id) !== 11) {
        return null;
      }
      return { ...state.workspace };
    },
    async updateById(_id, patch) {
      state.workspace = {
        ...state.workspace,
        ...patch
      };
      return { ...state.workspace };
    }
  };

  const workspaceSettingsRepository = {
    async ensureForWorkspaceId(workspaceId) {
      if (Number(workspaceId) !== 11) {
        return null;
      }

      return {
        ...state.settings,
        features: JSON.parse(JSON.stringify(state.settings.features || {})),
        policy: JSON.parse(JSON.stringify(state.settings.policy || {}))
      };
    },
    async updateByWorkspaceId() {
      throw new Error("settings write failed");
    }
  };

  const workspaceInvitesRepository = {
    async transaction(callback) {
      const snapshot = structuredClone(state);
      try {
        return await callback({ marker: "trx-object" });
      } catch (error) {
        state.workspace = snapshot.workspace;
        state.settings = snapshot.settings;
        throw error;
      }
    }
  };

  const service = createWorkspaceAdminService({
    appConfig: {
      features: {
        workspaceInvites: true
      }
    },
    rbacManifest: {
      defaultInviteRole: "member",
      collaborationEnabled: true,
      roles: {
        owner: { assignable: false, permissions: ["*"] },
        admin: { assignable: true, permissions: ["workspace.settings.update"] },
        member: { assignable: true, permissions: ["history.read"] }
      }
    },
    workspacesRepository,
    workspaceSettingsRepository,
    workspaceMembershipsRepository: {
      async listActiveByWorkspaceId() {
        return [];
      },
      async findByWorkspaceIdAndUserId() {
        return null;
      },
      async updateRoleByWorkspaceIdAndUserId() {},
      async ensureActiveByWorkspaceIdAndUserId() {}
    },
    workspaceInvitesRepository,
    userProfilesRepository: {
      async findByEmail() {
        return null;
      }
    },
    userSettingsRepository: null
  });

  await assert.rejects(
    () =>
      service.updateWorkspaceSettings(
        { id: 11 },
        {
          name: "Acme Prime",
          invitesEnabled: false
        }
      ),
    /settings write failed/
  );

  assert.equal(state.workspace.name, "Acme");
  assert.equal(state.settings.invitesEnabled, true);
});

test("workspace admin service rolls back invite acceptance when downstream write fails", async () => {
  const state = {
    workspace: {
      id: 11,
      slug: "acme",
      name: "Acme",
      color: "#0F6B54",
      avatarUrl: "",
      ownerUserId: 5,
      isPersonal: false
    },
    invite: {
      id: 301,
      workspaceId: 11,
      email: "accept@example.com",
      roleId: "admin",
      tokenHash: hexHash("6"),
      status: "pending",
      invitedByUserId: 5,
      expiresAt: "2030-01-01T00:00:00.000Z",
      workspace: {
        id: 11,
        slug: "acme",
        name: "Acme",
        color: "#0F6B54",
        avatarUrl: ""
      }
    },
    memberships: [],
    lastActiveWorkspaceId: null
  };

  const workspaceInvitesRepository = {
    async transaction(callback) {
      const snapshot = structuredClone(state);
      try {
        return await callback({ marker: "trx-object" });
      } catch (error) {
        state.invite = snapshot.invite;
        state.memberships = snapshot.memberships;
        state.lastActiveWorkspaceId = snapshot.lastActiveWorkspaceId;
        throw error;
      }
    },
    async markExpiredPendingInvites() {},
    async findPendingByTokenHash(tokenHash) {
      if (String(tokenHash || "").toLowerCase() === String(state.invite.tokenHash || "").toLowerCase()) {
        return {
          ...state.invite,
          workspace: {
            ...state.invite.workspace
          }
        };
      }

      return null;
    },
    async markAcceptedById() {
      throw new Error("accept write failed");
    },
    async revokeById() {
      return null;
    }
  };

  const service = createWorkspaceAdminService({
    appConfig: {
      features: {
        workspaceInvites: true
      }
    },
    rbacManifest: {
      defaultInviteRole: "member",
      collaborationEnabled: true,
      roles: {
        owner: { assignable: false, permissions: ["*"] },
        admin: { assignable: true, permissions: ["workspace.members.manage"] },
        member: { assignable: true, permissions: ["history.read"] }
      }
    },
    workspacesRepository: {
      async findById(id) {
        if (Number(id) !== 11) {
          return null;
        }
        return {
          ...state.workspace
        };
      }
    },
    workspaceSettingsRepository: {
      async ensureForWorkspaceId(workspaceId, defaults = {}) {
        if (Number(workspaceId) !== 11) {
          return null;
        }
        return {
          workspaceId: 11,
          invitesEnabled: Boolean(defaults.invitesEnabled),
          features: {},
          policy: defaults.policy || {}
        };
      }
    },
    workspaceMembershipsRepository: {
      async listActiveByWorkspaceId() {
        return [];
      },
      async findByWorkspaceIdAndUserId() {
        return null;
      },
      async updateRoleByWorkspaceIdAndUserId() {
        return null;
      },
      async ensureActiveByWorkspaceIdAndUserId(workspaceId, userId, roleId) {
        const membership = {
          id: state.memberships.length + 1,
          workspaceId: Number(workspaceId),
          userId: Number(userId),
          roleId: String(roleId || ""),
          status: "active"
        };
        state.memberships.push(membership);
        return membership;
      }
    },
    workspaceInvitesRepository,
    userProfilesRepository: {
      async findByEmail() {
        return null;
      }
    },
    userSettingsRepository: {
      async updateLastActiveWorkspaceId(_userId, workspaceId) {
        state.lastActiveWorkspaceId = Number(workspaceId);
      }
    }
  });

  await assert.rejects(
    () =>
      service.respondToPendingInviteByToken({
        user: {
          id: 41,
          email: "accept@example.com"
        },
        inviteToken: opaqueInviteToken(state.invite.tokenHash),
        decision: "accept"
      }),
    /accept write failed/
  );

  assert.equal(state.memberships.length, 0);
  assert.equal(state.invite.status, "pending");
  assert.equal(state.lastActiveWorkspaceId, null);
});

test("workspace admin service normalizes sparse member/invite data and fallback branches", async () => {
  const state = {
    workspace: {
      id: 11,
      slug: "",
      name: null,
      color: "bad-color",
      avatarUrl: null,
      ownerUserId: 5,
      isPersonal: false
    },
    settings: {
      workspaceId: 11,
      invitesEnabled: true,
      features: null,
      policy: null
    },
    insertedInvite: null
  };

  const workspacesRepository = {
    async findById(id) {
      if (Number(id) !== 11) {
        return null;
      }
      return { ...state.workspace };
    },
    async updateById(_id, patch) {
      state.workspace = {
        ...state.workspace,
        ...patch
      };
      return { ...state.workspace };
    }
  };

  const workspaceSettingsRepository = {
    async ensureForWorkspaceId(workspaceId) {
      if (Number(workspaceId) !== 11) {
        return null;
      }
      return {
        ...state.settings,
        features: state.settings.features,
        policy: state.settings.policy
      };
    },
    async updateByWorkspaceId(_workspaceId, patch) {
      state.settings = {
        ...state.settings,
        ...patch
      };
      return {
        ...state.settings
      };
    }
  };

  const workspaceMembershipsRepository = {
    async listActiveByWorkspaceId() {
      return [
        {
          userId: 42,
          user: null,
          roleId: "",
          status: undefined
        },
        {
          userId: 88,
          user: {},
          roleId: "owner",
          status: "active"
        }
      ];
    },
    async findByWorkspaceIdAndUserId(_workspaceId, userId) {
      if (Number(userId) === 9) {
        return {
          userId: 9,
          roleId: "member",
          status: "active"
        };
      }
      if (Number(userId) === 88) {
        return {
          userId: 88,
          roleId: "owner",
          status: "active"
        };
      }
      return null;
    },
    async updateRoleByWorkspaceIdAndUserId() {},
    async ensureActiveByWorkspaceIdAndUserId() {}
  };

  const inviteBase = {
    workspaceId: 11,
    email: "pending@example.com",
    roleId: "",
    tokenHash: hexHash("a"),
    status: "",
    expiresAt: "2030-01-01T00:00:00.000Z",
    invitedByUserId: null,
    invitedBy: {
      displayName: "",
      email: ""
    }
  };
  const tokenHashByInviteId = {
    600: hexHash("a"),
    700: hexHash("b"),
    701: hexHash("c"),
    702: hexHash("d"),
    703: hexHash("e")
  };

  const workspaceInvitesRepository = {
    async markExpiredPendingInvites() {},
    async expirePendingByWorkspaceIdAndEmail() {},
    async listPendingByWorkspaceIdWithWorkspace() {
      return [
        {
          id: 500,
          ...inviteBase,
          workspace: {
            id: 11,
            slug: null,
            name: null,
            color: "bad-color",
            avatarUrl: null
          }
        },
        {
          id: 501,
          ...inviteBase,
          workspace: null
        }
      ];
    },
    async findPendingByWorkspaceIdAndEmail() {
      return null;
    },
    async insert(payload) {
      state.insertedInvite = {
        ...payload
      };
    },
    async findPendingByIdForWorkspace() {
      return {
        id: 500,
        ...inviteBase,
        workspace: {
          id: 11,
          slug: "",
          name: "",
          color: "bad-color",
          avatarUrl: ""
        }
      };
    },
    async revokeById() {},
    async listPendingByEmail(email) {
      if (String(email) === "pending@example.com") {
        return [
          {
            id: 600,
            ...inviteBase,
            tokenHash: tokenHashByInviteId[600],
            workspace: {
              id: 11,
              slug: "",
              name: "",
              color: "bad-color",
              avatarUrl: ""
            }
          }
        ];
      }
      return [];
    },
    async findPendingByTokenHash(tokenHash) {
      if (String(tokenHash || "") === tokenHashByInviteId[700]) {
        return {
          id: 700,
          ...inviteBase,
          tokenHash: tokenHashByInviteId[700],
          workspace: null
        };
      }
      if (String(tokenHash || "") === tokenHashByInviteId[701]) {
        return {
          id: 701,
          ...inviteBase,
          tokenHash: tokenHashByInviteId[701],
          workspace: {
            id: 11,
            slug: "",
            name: "",
            color: "bad-color",
            avatarUrl: ""
          }
        };
      }
      if (String(tokenHash || "") === tokenHashByInviteId[702]) {
        return {
          id: 702,
          ...inviteBase,
          tokenHash: tokenHashByInviteId[702],
          roleId: "member",
          workspace: {
            id: 11,
            slug: null,
            name: null,
            color: "bad-color",
            avatarUrl: null
          }
        };
      }
      if (String(tokenHash || "") === tokenHashByInviteId[703]) {
        return {
          id: 703,
          ...inviteBase,
          tokenHash: tokenHashByInviteId[703],
          workspace: null
        };
      }
      return null;
    },
    async markAcceptedById() {}
  };

  const service = createWorkspaceAdminService({
    appConfig: {
      features: {
        workspaceInvites: true
      }
    },
    rbacManifest: {
      defaultInviteRole: "member",
      collaborationEnabled: true,
      roles: {
        owner: {
          assignable: false,
          permissions: ["*"]
        },
        admin: {
          assignable: true,
          permissions: ["workspace.members.manage"]
        },
        member: {
          assignable: true,
          permissions: ["history.read"]
        }
      }
    },
    workspacesRepository,
    workspaceSettingsRepository,
    workspaceMembershipsRepository,
    workspaceInvitesRepository,
    userProfilesRepository: {
      async findByEmail() {
        return null;
      }
    },
    userSettingsRepository: {
      async updateLastActiveWorkspaceId() {}
    }
  });

  const members = await service.listMembers({ id: 11 });
  assert.equal(members.members[0].email, "");
  assert.equal(members.members[0].displayName, "");
  assert.equal(members.members[0].status, "active");
  assert.equal(members.members[1].isOwner, true);

  await assert.rejects(
    () => service.updateMemberRole({ id: 11 }, { memberUserId: 9, roleId: "" }),
    (error) => error instanceof AppError && error.statusCode === 400
  );
  await assert.rejects(
    () => service.updateMemberRole({ id: 11 }, { memberUserId: 88, roleId: "admin" }),
    (error) => error instanceof AppError && error.statusCode === 409
  );

  const listedInvites = await service.listInvites({ id: 11 });
  assert.equal(listedInvites.invites.length, 2);
  assert.equal(listedInvites.invites[0].workspace.slug, "");
  assert.equal(listedInvites.invites[0].workspace.name, "");
  assert.equal(listedInvites.invites[0].workspace.avatarUrl, "");
  assert.equal(listedInvites.invites[1].workspace, null);

  await service.createInvite({ id: 11 }, {}, { email: "new@example.com" });
  assert.equal(state.insertedInvite.roleId, "member");
  assert.equal(state.insertedInvite.invitedByUserId, null);

  await service.updateWorkspaceSettings(
    { id: 11 },
    {
      defaultMode: "pv",
      defaultTiming: "due",
      defaultPaymentsPerYear: 4,
      defaultHistoryPageSize: 25,
      appDenyEmails: ["one@example.com"],
      appDenyUserIds: [2]
    }
  );
  assert.deepEqual(state.settings.policy, {
    defaultMode: "pv",
    defaultTiming: "due",
    defaultPaymentsPerYear: 4,
    defaultHistoryPageSize: 25
  });
  assert.deepEqual(state.settings.features.surfaceAccess.app, {
    denyEmails: ["one@example.com"],
    denyUserIds: [2]
  });

  const pendingNone = await service.listPendingInvitesForUser({
    id: 99,
    email: "none@example.com"
  });
  assert.deepEqual(pendingNone, []);
  const pendingSome = await service.listPendingInvitesForUser({
    id: 99,
    email: "pending@example.com"
  });
  assert.equal(pendingSome.length, 1);
  assert.equal(typeof pendingSome[0].token, "string");
  assert.equal(pendingSome[0].token.length > 0, true);

  await assert.rejects(
    () =>
      service.respondToPendingInviteByToken({
        user: {
          id: 99,
          email: "pending@example.com"
        },
        inviteToken: opaqueInviteToken(tokenHashByInviteId[700])
      }),
    (error) => error instanceof AppError && error.statusCode === 400
  );

  const refusedNullWorkspace = await service.respondToPendingInviteByToken({
    user: {
      id: 99,
      email: "pending@example.com"
    },
    inviteToken: opaqueInviteToken(tokenHashByInviteId[700]),
    decision: "refuse"
  });
  assert.equal(refusedNullWorkspace.workspace, null);

  const refusedWithSparseWorkspace = await service.respondToPendingInviteByToken({
    user: {
      id: 99,
      email: "pending@example.com"
    },
    inviteToken: opaqueInviteToken(tokenHashByInviteId[702]),
    decision: "refuse"
  });
  assert.deepEqual(refusedWithSparseWorkspace.workspace, {
    id: 11,
    slug: "",
    name: "",
    color: "#0F6B54",
    avatarUrl: ""
  });

  const acceptedWithSparseWorkspace = await service.respondToPendingInviteByToken({
    user: {
      id: 100,
      email: "pending@example.com"
    },
    inviteToken: opaqueInviteToken(tokenHashByInviteId[701]),
    decision: "accept"
  });
  assert.deepEqual(acceptedWithSparseWorkspace.workspace, {
    id: 11,
    slug: "",
    name: "",
    color: "#0F6B54",
    avatarUrl: ""
  });

  const acceptedNullWorkspace = await service.respondToPendingInviteByToken({
    user: {
      id: 100,
      email: "pending@example.com"
    },
    inviteToken: opaqueInviteToken(tokenHashByInviteId[703]),
    decision: "accept"
  });
  assert.equal(acceptedNullWorkspace.workspace, null);
});
