import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../server/lib/errors.js";
import { createService as createWorkspaceService } from "../server/domain/workspace/services/workspace.service.js";

function createWorkspaceServiceFixture(options = {}) {
  const workspace11 = {
    id: 11,
    slug: "acme",
    name: "Acme",
    color: "#0F6B54",
    avatarUrl: "",
    ownerUserId: 5,
    isPersonal: false
  };
  const workspace12 = {
    id: 12,
    slug: "blocked",
    name: "Blocked",
    color: "#112233",
    avatarUrl: "",
    ownerUserId: 6,
    isPersonal: false
  };

  const state = {
    allWorkspaces: [workspace11, workspace12],
    membershipsByUserId: new Map([
      [
        5,
        [
          {
            ...workspace11,
            roleId: "member",
            membershipStatus: "active"
          },
          {
            ...workspace12,
            roleId: "member",
            membershipStatus: "pending"
          }
        ]
      ]
    ]),
    membershipsLookup: new Map([
      ["11:5", { workspaceId: 11, userId: 5, roleId: "member", status: "active" }],
      ["12:5", { workspaceId: 12, userId: 5, roleId: "member", status: "pending" }]
    ]),
    workspaceSettingsById: new Map([
      [
        11,
        {
          workspaceId: 11,
          invitesEnabled: true,
          features: {},
          policy: {
            defaultMode: "pv",
            defaultTiming: "due",
            defaultPaymentsPerYear: 4,
            defaultHistoryPageSize: 25
          }
        }
      ],
      [
        12,
        {
          workspaceId: 12,
          invitesEnabled: true,
          features: {
            surfaceAccess: {
              app: {
                denyEmails: ["user@example.com"]
              }
            }
          },
          policy: {}
        }
      ]
    ]),
    personalWorkspaceByOwnerId: new Map(),
    nextWorkspaceId: 90,
    userSettingsByUserId: new Map([
      [
        5,
        {
          theme: "system",
          locale: "en-US",
          timeZone: "UTC",
          dateFormat: "system",
          numberFormat: "system",
          currencyCode: "USD",
          avatarSize: 64,
          lastActiveWorkspaceId: 11
        }
      ]
    ]),
    pendingInvitesByEmail: new Map([
      [
        "user@example.com",
        [
          {
            id: 201,
            workspaceId: 11,
            tokenHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            roleId: "member",
            status: "pending",
            expiresAt: "2030-01-01T00:00:00.000Z",
            invitedBy: {
              displayName: "Owner",
              email: "owner@example.com"
            },
            workspace: {
              id: 11,
              slug: "acme",
              name: "Acme",
              color: "#0F6B54",
              avatarUrl: ""
            }
          }
        ]
      ]
    ]),
    calls: {
      ensureOwnerMembership: 0,
      ensureWorkspaceSettings: 0,
      findWorkspaceSettingsByWorkspaceIds: 0,
      updateLastActiveWorkspaceId: 0,
      markExpiredPendingInvites: 0,
      findByWorkspaceIdAndUserId: 0,
      listByUserIdAndWorkspaceIds: 0
    }
  };

  const workspacesRepository = {
    async findBySlug(slug) {
      return state.allWorkspaces.find((workspace) => workspace.slug === String(slug || "")) || null;
    },
    async findById(id) {
      return state.allWorkspaces.find((workspace) => Number(workspace.id) === Number(id)) || null;
    },
    async findPersonalByOwnerUserId(ownerUserId) {
      return state.personalWorkspaceByOwnerId.get(Number(ownerUserId)) || null;
    },
    async insert(payload) {
      const workspace = {
        id: state.nextWorkspaceId++,
        slug: payload.slug,
        name: payload.name,
        color: payload.color || "#0F6B54",
        avatarUrl: payload.avatarUrl || "",
        ownerUserId: Number(payload.ownerUserId),
        isPersonal: Boolean(payload.isPersonal)
      };
      state.allWorkspaces.push(workspace);
      state.personalWorkspaceByOwnerId.set(Number(payload.ownerUserId), workspace);
      return workspace;
    },
    async listByUserId(userId) {
      return [...(state.membershipsByUserId.get(Number(userId)) || [])];
    }
  };

  const workspaceMembershipsRepository = {
    async ensureOwnerMembership(workspaceId, userId) {
      state.calls.ensureOwnerMembership += 1;
      state.membershipsLookup.set(`${workspaceId}:${userId}`, {
        workspaceId: Number(workspaceId),
        userId: Number(userId),
        roleId: "owner",
        status: "active"
      });
    },
    async findByWorkspaceIdAndUserId(workspaceId, userId) {
      state.calls.findByWorkspaceIdAndUserId += 1;
      return state.membershipsLookup.get(`${Number(workspaceId)}:${Number(userId)}`) || null;
    },
    async listByUserIdAndWorkspaceIds(userId, workspaceIds) {
      state.calls.listByUserIdAndWorkspaceIds += 1;
      return Array.from(
        new Set(
          (Array.isArray(workspaceIds) ? workspaceIds : [])
            .map((workspaceId) => Number(workspaceId))
            .filter((workspaceId) => Number.isInteger(workspaceId) && workspaceId > 0)
        )
      )
        .map((workspaceId) => state.membershipsLookup.get(`${workspaceId}:${Number(userId)}`) || null)
        .filter(Boolean);
    }
  };

  const workspaceSettingsRepository = {
    async findByWorkspaceIds(workspaceIds) {
      state.calls.findWorkspaceSettingsByWorkspaceIds += 1;
      return Array.from(
        new Set(
          (Array.isArray(workspaceIds) ? workspaceIds : [])
            .map((workspaceId) => Number(workspaceId))
            .filter((workspaceId) => Number.isInteger(workspaceId) && workspaceId > 0)
        )
      )
        .map((workspaceId) => state.workspaceSettingsById.get(workspaceId) || null)
        .filter(Boolean);
    },
    async ensureForWorkspaceId(workspaceId, defaults = {}) {
      state.calls.ensureWorkspaceSettings += 1;
      const numericWorkspaceId = Number(workspaceId);
      if (!state.workspaceSettingsById.has(numericWorkspaceId)) {
        state.workspaceSettingsById.set(numericWorkspaceId, {
          workspaceId: numericWorkspaceId,
          invitesEnabled: Boolean(defaults.invitesEnabled),
          features: defaults.features || {},
          policy: defaults.policy || {}
        });
      }
      return state.workspaceSettingsById.get(numericWorkspaceId);
    }
  };

  const workspaceInvitesRepository = {
    async markExpiredPendingInvites() {
      state.calls.markExpiredPendingInvites += 1;
    },
    async listPendingByEmail(email) {
      const nowIso = new Date().toISOString();
      return [...(state.pendingInvitesByEmail.get(String(email || "").toLowerCase()) || [])].filter(
        (invite) => String(invite?.status || "") === "pending" && String(invite?.expiresAt || "") > nowIso
      );
    }
  };

  const userSettingsRepository = {
    async ensureForUserId(userId) {
      const numericUserId = Number(userId);
      if (!state.userSettingsByUserId.has(numericUserId)) {
        state.userSettingsByUserId.set(numericUserId, {
          theme: "system",
          locale: "en-US",
          timeZone: "UTC",
          dateFormat: "system",
          numberFormat: "system",
          currencyCode: "USD",
          avatarSize: 64,
          lastActiveWorkspaceId: null
        });
      }
      return state.userSettingsByUserId.get(numericUserId);
    },
    async updateLastActiveWorkspaceId(userId, workspaceId) {
      state.calls.updateLastActiveWorkspaceId += 1;
      const current = await this.ensureForUserId(userId);
      state.userSettingsByUserId.set(Number(userId), {
        ...current,
        lastActiveWorkspaceId: Number(workspaceId)
      });
    }
  };

  const appConfig = {
    tenancyMode: "multi-workspace",
    features: {
      workspaceInvites: true,
      workspaceSwitching: true,
      workspaceCreateEnabled: true
    },
    ...(options.appConfig || {})
  };
  const rbacManifest = {
    defaultInviteRole: "member",
    collaborationEnabled: true,
    roles: {
      owner: {
        assignable: false,
        permissions: ["*"]
      },
      member: {
        assignable: true,
        permissions: ["history.read", "history.write"]
      }
    },
    ...(options.rbacManifest || {})
  };
  const userAvatarService = Object.hasOwn(options, "userAvatarService")
    ? options.userAvatarService
    : {
        buildAvatarResponse(user, { avatarSize }) {
          return {
            uploadedUrl: null,
            gravatarUrl: `https://www.gravatar.com/avatar/${Number(user.id)}`,
            effectiveUrl: `https://www.gravatar.com/avatar/${Number(user.id)}`,
            hasUploadedAvatar: false,
            size: avatarSize,
            version: null
          };
        }
      };

  const service = createWorkspaceService({
    appConfig,
    rbacManifest,
    workspacesRepository,
    workspaceMembershipsRepository,
    workspaceSettingsRepository,
    workspaceInvitesRepository,
    userSettingsRepository,
    userAvatarService
  });

  return {
    state,
    service
  };
}

test("workspace service validates constructor and resolves permission helpers", async () => {
  assert.throws(() => createWorkspaceService({}), /repositories are required/);

  const { service } = createWorkspaceServiceFixture();
  assert.deepEqual(service.resolvePermissions("owner"), ["*"]);
  assert.deepEqual(service.resolvePermissions("member"), ["history.read", "history.write"]);
  assert.deepEqual(service.resolvePermissions(""), []);
});

test("workspace service ensures personal workspace and handles slug collisions", async () => {
  const { service, state } = createWorkspaceServiceFixture({
    appConfig: {
      tenancyMode: "personal"
    }
  });

  // Force a slug collision so ensureUniqueWorkspaceSlug appends suffix.
  state.allWorkspaces.push({
    id: 40,
    slug: "chiara",
    name: "Chiara",
    color: "#0F6B54",
    avatarUrl: "",
    ownerUserId: 9,
    isPersonal: false
  });

  const workspace = await service.ensurePersonalWorkspaceForUser({
    id: 88,
    displayName: "Chiara",
    email: "chiara@example.com"
  });

  assert.equal(workspace.slug.startsWith("chiara"), true);
  assert.equal(state.calls.ensureOwnerMembership > 0, true);
  assert.equal(state.calls.ensureWorkspaceSettings > 0, true);
  assert.equal(state.calls.updateLastActiveWorkspaceId > 0, true);

  await assert.rejects(
    () => service.ensurePersonalWorkspaceForUser({ id: 0 }),
    (error) => error instanceof AppError && error.statusCode === 400
  );
});

test("workspace service ensures personal workspace transactionally and recovers from duplicate insert races", async () => {
  const existingWorkspace = {
    id: 501,
    slug: "tony",
    name: "Tony Workspace",
    color: "#0F6B54",
    avatarUrl: "",
    ownerUserId: 77,
    isPersonal: true
  };

  const calls = {
    transaction: 0,
    findBySlug: [],
    findPersonal: [],
    insert: [],
    ensureOwnerMembership: [],
    ensureWorkspaceSettings: [],
    ensureForUserId: [],
    updateLastActiveWorkspaceId: []
  };

  let personalLookupCount = 0;
  const workspacesRepository = {
    async transaction(work) {
      calls.transaction += 1;
      return work({ marker: "trx-object" });
    },
    async findBySlug(slug, options = {}) {
      calls.findBySlug.push({ slug, options });
      return null;
    },
    async findById() {
      return null;
    },
    async findPersonalByOwnerUserId(ownerUserId, options = {}) {
      personalLookupCount += 1;
      calls.findPersonal.push({ ownerUserId, options, personalLookupCount });
      if (personalLookupCount < 2) {
        return null;
      }
      return existingWorkspace;
    },
    async insert(payload, options = {}) {
      calls.insert.push({ payload, options });
      const error = new Error("duplicate personal workspace");
      error.code = "ER_DUP_ENTRY";
      throw error;
    },
    async listByUserId() {
      return [];
    }
  };

  const workspaceMembershipsRepository = {
    async ensureOwnerMembership(workspaceId, userId, options = {}) {
      calls.ensureOwnerMembership.push({ workspaceId, userId, options });
      return {
        workspaceId,
        userId,
        roleId: "owner",
        status: "active"
      };
    },
    async findByWorkspaceIdAndUserId() {
      return null;
    }
  };

  const workspaceSettingsRepository = {
    async ensureForWorkspaceId(workspaceId, defaults = {}, options = {}) {
      calls.ensureWorkspaceSettings.push({ workspaceId, defaults, options });
      return {
        workspaceId,
        invitesEnabled: Boolean(defaults.invitesEnabled),
        features: defaults.features || {},
        policy: defaults.policy || {}
      };
    }
  };

  const userSettingsRepository = {
    async ensureForUserId(userId, options = {}) {
      calls.ensureForUserId.push({ userId, options });
      return {
        userId,
        lastActiveWorkspaceId: null
      };
    },
    async updateLastActiveWorkspaceId(userId, workspaceId, options = {}) {
      calls.updateLastActiveWorkspaceId.push({ userId, workspaceId, options });
      return {
        userId,
        lastActiveWorkspaceId: workspaceId
      };
    }
  };

  const service = createWorkspaceService({
    appConfig: {
      tenancyMode: "multi-workspace",
      features: {
        workspaceInvites: true,
        workspaceSwitching: true,
        workspaceCreateEnabled: true
      }
    },
    rbacManifest: {
      collaborationEnabled: true,
      roles: {
        owner: { assignable: false, permissions: ["*"] },
        member: { assignable: true, permissions: [] }
      }
    },
    workspacesRepository,
    workspaceMembershipsRepository,
    workspaceSettingsRepository,
    workspaceInvitesRepository: {
      async listPendingByEmail() {
        return [];
      }
    },
    userSettingsRepository,
    userAvatarService: null
  });

  const workspace = await service.ensurePersonalWorkspaceForUser({
    id: 77,
    displayName: "Tony",
    email: "tony@example.com"
  });

  assert.equal(workspace.id, existingWorkspace.id);
  assert.equal(calls.transaction, 1);
  assert.equal(calls.insert.length, 1);
  assert.equal(calls.ensureOwnerMembership.length, 1);
  assert.equal(calls.ensureWorkspaceSettings.length, 1);
  assert.equal(calls.ensureForUserId.length, 1);
  assert.equal(calls.updateLastActiveWorkspaceId.length, 1);
  assert.equal(calls.ensureOwnerMembership[0].options.trx.marker, "trx-object");
  assert.equal(calls.ensureWorkspaceSettings[0].options.trx.marker, "trx-object");
  assert.equal(calls.ensureForUserId[0].options.trx.marker, "trx-object");
  assert.equal(calls.updateLastActiveWorkspaceId[0].options.trx.marker, "trx-object");
});

test("workspace service list/select methods enforce auth, access rules, and workspace selector resolution", async () => {
  const { service, state } = createWorkspaceServiceFixture();

  await assert.rejects(
    () => service.selectWorkspaceForUser({ id: null }, "acme"),
    (error) => error instanceof AppError && error.statusCode === 401
  );
  await assert.rejects(
    () => service.selectWorkspaceForUser({ id: 5, email: "user@example.com" }, ""),
    (error) => error instanceof AppError && error.statusCode === 400
  );
  await assert.rejects(
    () => service.selectWorkspaceForUser({ id: 5, email: "user@example.com" }, "missing"),
    (error) => error instanceof AppError && error.statusCode === 403
  );
  await assert.rejects(
    () => service.selectWorkspaceForUser({ id: 5, email: "user@example.com" }, "blocked"),
    (error) => error instanceof AppError && error.statusCode === 403
  );

  const selectedBySlug = await service.selectWorkspaceForUser(
    {
      id: 5,
      email: "user@example.com"
    },
    "acme",
    {
      request: {
        headers: {
          "x-surface-id": "app"
        }
      }
    }
  );
  assert.equal(selectedBySlug.workspace.slug, "acme");
  assert.equal(selectedBySlug.membership.roleId, "member");
  assert.equal(selectedBySlug.permissions.includes("history.read"), true);
  assert.equal(selectedBySlug.workspaceSettings.defaultMode, "pv");

  const selectedById = await service.selectWorkspaceForUser(
    {
      id: 5,
      email: "user@example.com"
    },
    "11",
    {
      request: {
        headers: {
          "x-surface-id": "app"
        }
      }
    }
  );
  assert.equal(selectedById.workspace.id, 11);
  assert.equal(state.calls.updateLastActiveWorkspaceId >= 2, true);

  await assert.rejects(
    () => service.listWorkspacesForUser({ id: null }),
    (error) => error instanceof AppError && error.statusCode === 401
  );

  const listed = await service.listWorkspacesForUser(
    {
      id: 5,
      email: "user@example.com"
    },
    {
      request: {
        headers: {
          "x-surface-id": "admin"
        }
      }
    }
  );
  assert.equal(Array.isArray(listed), true);
  assert.equal(listed.length, 2);
  assert.equal(listed.find((workspace) => workspace.slug === "acme").isAccessible, true);
  assert.equal(listed.find((workspace) => workspace.slug === "blocked").isAccessible, false);
});

test("workspace service resolves request context and workspace policy branches", async () => {
  const { service, state } = createWorkspaceServiceFixture();

  const anonymousContext = await service.resolveRequestContext({
    user: null,
    request: {},
    workspacePolicy: "optional"
  });
  assert.deepEqual(anonymousContext, {
    workspace: null,
    membership: null,
    permissions: [],
    workspaces: [],
    userSettings: null
  });

  const optionalContext = await service.resolveRequestContext({
    user: {
      id: 5,
      email: "user@example.com"
    },
    request: {
      headers: {
        "x-surface-id": "app",
        "x-workspace-slug": "acme"
      }
    },
    workspacePolicy: "optional"
  });
  assert.equal(optionalContext.workspace.slug, "acme");
  assert.equal(optionalContext.membership.roleId, "member");
  assert.equal(optionalContext.permissions.includes("history.read"), true);
  assert.equal(optionalContext.userSettings.lastActiveWorkspaceId, 11);

  await assert.rejects(
    () =>
      service.resolveRequestContext({
        user: {
          id: 5,
          email: "user@example.com"
        },
        request: {
          headers: {
            "x-surface-id": "app",
            "x-workspace-slug": "blocked"
          }
        },
        workspacePolicy: "optional"
      }),
    (error) => error instanceof AppError && error.statusCode === 403
  );

  state.userSettingsByUserId.set(5, {
    theme: "system",
    locale: "en-US",
    timeZone: "UTC",
    dateFormat: "system",
    numberFormat: "system",
    currencyCode: "USD",
    avatarSize: 64,
    lastActiveWorkspaceId: null
  });
  state.membershipsByUserId.set(5, []);

  await assert.rejects(
    () =>
      service.resolveRequestContext({
        user: {
          id: 5,
          email: "user@example.com"
        },
        request: {
          headers: {
            "x-surface-id": "app"
          }
        },
        workspacePolicy: "required"
      }),
    (error) => error instanceof AppError && error.statusCode === 409
  );
});

test("workspace service preloads workspace settings in batch for workspace mapping", async () => {
  const { service, state } = createWorkspaceServiceFixture();
  state.calls.findWorkspaceSettingsByWorkspaceIds = 0;
  state.calls.ensureWorkspaceSettings = 0;

  const listed = await service.listWorkspacesForUser(
    {
      id: 5,
      email: "user@example.com"
    },
    {
      request: {
        headers: {
          "x-surface-id": "app"
        }
      }
    }
  );

  assert.equal(listed.length, 2);
  assert.equal(state.calls.findWorkspaceSettingsByWorkspaceIds, 1);
  assert.equal(state.calls.ensureWorkspaceSettings, 0);
});

test("workspace service ensures settings only for ids missing from batch preload", async () => {
  const { service, state } = createWorkspaceServiceFixture();
  state.workspaceSettingsById.delete(12);
  state.calls.findWorkspaceSettingsByWorkspaceIds = 0;
  state.calls.ensureWorkspaceSettings = 0;

  const listed = await service.listWorkspacesForUser(
    {
      id: 5,
      email: "user@example.com"
    },
    {
      request: {
        headers: {
          "x-surface-id": "app"
        }
      }
    }
  );

  assert.equal(listed.length, 2);
  assert.equal(state.calls.findWorkspaceSettingsByWorkspaceIds, 1);
  assert.equal(state.calls.ensureWorkspaceSettings, 1);
  assert.equal(state.workspaceSettingsById.has(12), true);
});

test("workspace service builds bootstrap payload for authenticated and unauthenticated sessions", async () => {
  const { service, state } = createWorkspaceServiceFixture();

  const signedOut = await service.buildBootstrapPayload({
    request: {},
    user: null
  });
  assert.equal(signedOut.session.authenticated, false);
  assert.deepEqual(signedOut.workspaces, []);
  assert.equal(signedOut.activeWorkspace, null);
  assert.equal(signedOut.workspaceSettings, null);

  const signedIn = await service.buildBootstrapPayload({
    request: {
      headers: {
        "x-surface-id": "app",
        "x-workspace-slug": "acme"
      }
    },
    user: {
      id: 5,
      displayName: "Tony",
      email: "user@example.com"
    }
  });
  assert.equal(signedIn.session.authenticated, true);
  assert.equal(signedIn.profile.displayName, "Tony");
  assert.equal(signedIn.profile.avatar.size, 64);
  assert.equal(Array.isArray(signedIn.pendingInvites), true);
  assert.equal(state.calls.markExpiredPendingInvites, 0);
  assert.equal(signedIn.activeWorkspace.slug, "acme");
  assert.equal(signedIn.workspaceSettings.defaultMode, "pv");
  assert.equal(signedIn.userSettings.theme, "system");

  const fixtureWithoutAvatarService = createWorkspaceServiceFixture({
    userAvatarService: null
  });
  const bootstrapWithoutAvatar = await fixtureWithoutAvatarService.service.buildBootstrapPayload({
    request: {
      headers: {
        "x-surface-id": "app",
        "x-workspace-slug": "acme"
      }
    },
    user: {
      id: 5,
      displayName: "Tony",
      email: "user@example.com"
    }
  });
  assert.equal(bootstrapWithoutAvatar.profile.avatar, null);
});

test("workspace service pending invite listing handles unsupported repositories and membership filtering", async () => {
  const fixture = createWorkspaceServiceFixture();
  fixture.state.membershipsLookup.set("11:5", {
    workspaceId: 11,
    userId: 5,
    roleId: "member",
    status: "pending"
  });
  const pending = await fixture.service.listPendingInvitesForUser({
    id: 5,
    email: "user@example.com"
  });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].workspaceSlug, "acme");
  assert.equal(typeof pending[0].token, "string");
  assert.equal(pending[0].token.length > 0, true);

  fixture.state.membershipsLookup.set("11:5", {
    workspaceId: 11,
    userId: 5,
    roleId: "member",
    status: "active"
  });
  const filtered = await fixture.service.listPendingInvitesForUser({
    id: 5,
    email: "user@example.com"
  });
  assert.equal(filtered.length, 0);

  const unsupportedRepositoryService = createWorkspaceService({
    appConfig: {
      tenancyMode: "multi-workspace",
      features: {
        workspaceInvites: true,
        workspaceSwitching: true,
        workspaceCreateEnabled: true
      }
    },
    rbacManifest: {
      defaultInviteRole: "member",
      collaborationEnabled: true,
      roles: {
        owner: {
          assignable: false,
          permissions: ["*"]
        }
      }
    },
    workspacesRepository: {
      async listByUserId() {
        return [];
      },
      async findBySlug() {
        return null;
      },
      async findById() {
        return null;
      },
      async findPersonalByOwnerUserId() {
        return null;
      },
      async insert() {
        throw new Error("not used");
      }
    },
    workspaceMembershipsRepository: {
      async ensureOwnerMembership() {},
      async findByWorkspaceIdAndUserId() {
        return null;
      }
    },
    workspaceSettingsRepository: {
      async ensureForWorkspaceId() {
        return {
          invitesEnabled: true,
          features: {},
          policy: {}
        };
      }
    },
    workspaceInvitesRepository: null,
    userSettingsRepository: {
      async ensureForUserId() {
        return {
          lastActiveWorkspaceId: null
        };
      },
      async updateLastActiveWorkspaceId() {}
    },
    userAvatarService: null
  });
  assert.deepEqual(
    await unsupportedRepositoryService.listPendingInvitesForUser({
      id: 5,
      email: "user@example.com"
    }),
    []
  );
});

test("workspace service pending invite listing uses O(1) membership lookups for large invite sets", async () => {
  const fixture = createWorkspaceServiceFixture();
  const email = "bulk@example.com";
  const invites = [];

  for (let index = 0; index < 100; index += 1) {
    const workspaceId = 1000 + index;
    invites.push({
      id: 3000 + index,
      workspaceId,
      tokenHash: String(3000 + index).padStart(64, "0"),
      roleId: "member",
      status: "pending",
      expiresAt: "2030-01-01T00:00:00.000Z",
      invitedBy: {
        displayName: "Owner",
        email: "owner@example.com"
      },
      workspace: {
        id: workspaceId,
        slug: `workspace-${workspaceId}`,
        name: `Workspace ${workspaceId}`,
        color: "#0F6B54",
        avatarUrl: ""
      }
    });
  }

  fixture.state.pendingInvitesByEmail.set(email, invites);
  fixture.state.membershipsLookup.set("1005:5", {
    workspaceId: 1005,
    userId: 5,
    roleId: "member",
    status: "active"
  });

  const pending = await fixture.service.listPendingInvitesForUser({
    id: 5,
    email
  });

  assert.equal(pending.length, 99);
  assert.equal(fixture.state.calls.listByUserIdAndWorkspaceIds, 1);
  assert.equal(fixture.state.calls.findByWorkspaceIdAndUserId, 0);
});

test("workspace service handles sparse workspace payloads and fallback branches", async () => {
  const updateCalls = [];
  const sparseWorkspace = {
    id: 21,
    slug: "",
    name: null,
    color: "bad-color",
    avatarUrl: null,
    roleId: "member",
    membershipStatus: "active",
    ownerUserId: 77,
    isPersonal: false
  };

  const service = createWorkspaceService({
    appConfig: {
      tenancyMode: "multi-workspace",
      features: {
        workspaceInvites: true,
        workspaceSwitching: true,
        workspaceCreateEnabled: true
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
        member: {
          assignable: true,
          permissions: ["history.read"]
        }
      }
    },
    workspacesRepository: {
      async listByUserId(userId) {
        if (Number(userId) === 2) {
          return [sparseWorkspace];
        }
        if (Number(userId) === 4) {
          return [
            {
              ...sparseWorkspace,
              id: 0,
              slug: "invalid-id"
            }
          ];
        }
        return [];
      },
      async findBySlug() {
        return null;
      },
      async findById(id) {
        if (Number(id) === 21) {
          return {
            ...sparseWorkspace
          };
        }
        return null;
      },
      async findPersonalByOwnerUserId() {
        return null;
      },
      async insert() {
        throw new Error("not used");
      }
    },
    workspaceMembershipsRepository: {
      async ensureOwnerMembership() {},
      async findByWorkspaceIdAndUserId(workspaceId, userId) {
        if (Number(workspaceId) === 21 && Number(userId) === 2) {
          return {
            workspaceId: 21,
            userId: 2,
            roleId: "member",
            status: "active"
          };
        }
        return null;
      }
    },
    workspaceSettingsRepository: {
      async ensureForWorkspaceId(workspaceId) {
        if (Number(workspaceId) === 21) {
          return {
            invitesEnabled: true,
            features: {},
            policy: {}
          };
        }
        return {
          invitesEnabled: true,
          features: {},
          policy: {}
        };
      }
    },
    workspaceInvitesRepository: {
      async markExpiredPendingInvites() {},
      async listPendingByEmail() {
        return [];
      }
    },
    userSettingsRepository: {
      async ensureForUserId(userId) {
        if (Number(userId) === 2) {
          return {
            lastActiveWorkspaceId: 999
          };
        }
        if (Number(userId) === 3) {
          return {
            avatarSize: 0,
            lastActiveWorkspaceId: null
          };
        }
        return {
          lastActiveWorkspaceId: null
        };
      },
      async updateLastActiveWorkspaceId(userId, workspaceId) {
        updateCalls.push([Number(userId), Number(workspaceId)]);
      }
    },
    userAvatarService: {
      buildAvatarResponse() {
        return {
          uploadedUrl: null,
          gravatarUrl: "https://www.gravatar.com/avatar/edge",
          effectiveUrl: "https://www.gravatar.com/avatar/edge",
          hasUploadedAvatar: false,
          size: 0,
          version: null
        };
      }
    }
  });

  await assert.rejects(
    () =>
      service.resolveRequestContext({
        user: {
          id: 2,
          email: "sparse@example.com"
        },
        request: {
          headers: {
            "x-surface-id": "app",
            "x-workspace-slug": "missing"
          }
        },
        workspacePolicy: "optional"
      }),
    (error) => error instanceof AppError && error.statusCode === 403
  );

  const context = await service.resolveRequestContext({
    user: {
      id: 2,
      email: "sparse@example.com"
    },
    request: {
      headers: {
        "x-surface-id": "app"
      }
    },
    workspacePolicy: "optional"
  });
  assert.equal(context.workspace.slug, "");
  assert.equal(context.workspace.name, "");
  assert.equal(context.workspace.avatarUrl, "");
  assert.equal(context.userSettings.lastActiveWorkspaceId, 999);
  assert.equal(
    updateCalls.some(([userId, workspaceId]) => userId === 2 && workspaceId === 21),
    true
  );

  sparseWorkspace.avatarUrl = "https://example.com/avatar.png";
  const contextWithAvatar = await service.resolveRequestContext({
    user: {
      id: 2,
      email: "sparse@example.com"
    },
    request: {
      headers: {
        "x-surface-id": "app"
      }
    },
    workspacePolicy: "optional"
  });
  assert.equal(contextWithAvatar.workspace.avatarUrl, "https://example.com/avatar.png");

  const selected = await service.selectWorkspaceForUser(
    {
      id: 2,
      email: "sparse@example.com"
    },
    "21",
    {
      request: {
        headers: {
          "x-surface-id": "app"
        }
      }
    }
  );
  assert.equal(selected.workspace.slug, "");
  assert.equal(selected.workspace.name, "");
  assert.equal(selected.workspace.avatarUrl, "https://example.com/avatar.png");

  const listedInvalidWorkspaceId = await service.listWorkspacesForUser(
    {
      id: 4,
      email: "invalid-id@example.com"
    },
    {
      request: {
        headers: {
          "x-surface-id": "app"
        }
      }
    }
  );
  assert.equal(listedInvalidWorkspaceId.length, 1);
  assert.equal(listedInvalidWorkspaceId[0].isAccessible, false);

  assert.deepEqual(
    await service.listPendingInvitesForUser({
      id: 0,
      email: ""
    }),
    []
  );
  assert.deepEqual(
    await service.listPendingInvitesForUser({
      id: 2,
      email: "none@example.com"
    }),
    []
  );

  const bootstrapWithoutWorkspace = await service.buildBootstrapPayload({
    request: {
      headers: {
        "x-surface-id": "app"
      }
    },
    user: {
      id: 3
    }
  });
  assert.equal(bootstrapWithoutWorkspace.session.username, null);
  assert.equal(bootstrapWithoutWorkspace.profile.displayName, "");
  assert.equal(bootstrapWithoutWorkspace.profile.email, "");
  assert.equal(bootstrapWithoutWorkspace.profile.avatar.size, 64);
  assert.equal(bootstrapWithoutWorkspace.activeWorkspace, null);
  assert.equal(bootstrapWithoutWorkspace.workspaceSettings, null);
  assert.equal(bootstrapWithoutWorkspace.userSettings.avatarSize, 64);

  const personalFixture = createWorkspaceServiceFixture({
    appConfig: {
      tenancyMode: "personal"
    }
  });
  const personalContext = await personalFixture.service.resolveRequestContext({
    user: {
      id: 5,
      email: "user@example.com"
    },
    request: {
      headers: {
        "x-surface-id": "app"
      }
    },
    workspacePolicy: "optional"
  });
  assert.equal(Array.isArray(personalContext.workspaces), true);
  await personalFixture.service.selectWorkspaceForUser(
    {
      id: 5,
      email: "user@example.com"
    },
    "acme",
    {
      request: {
        headers: {
          "x-surface-id": "app"
        }
      }
    }
  );
  const personalListed = await personalFixture.service.listWorkspacesForUser(
    {
      id: 5,
      email: "user@example.com"
    },
    {
      request: {
        headers: {
          "x-surface-id": "app"
        }
      }
    }
  );
  assert.equal(Array.isArray(personalListed), true);
});
