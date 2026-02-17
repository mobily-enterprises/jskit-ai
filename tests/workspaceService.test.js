import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../lib/errors.js";
import { createWorkspaceService } from "../services/workspaceService.js";

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
      updateLastActiveWorkspaceId: 0,
      markExpiredPendingInvites: 0
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
      return state.membershipsLookup.get(`${Number(workspaceId)}:${Number(userId)}`) || null;
    }
  };

  const workspaceSettingsRepository = {
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
      return [...(state.pendingInvitesByEmail.get(String(email || "").toLowerCase()) || [])];
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
  const userAvatarService = Object.prototype.hasOwnProperty.call(options, "userAvatarService")
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
  assert.equal(state.calls.markExpiredPendingInvites > 0, true);
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
