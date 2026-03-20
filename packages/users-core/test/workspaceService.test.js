import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server/common/services/workspaceContextService.js";

function createWorkspaceRoles() {
  return {
    defaultInviteRole: "member",
    roles: {
      owner: {
        assignable: false,
        permissions: ["*"]
      },
      member: {
        assignable: true,
        permissions: ["workspace.settings.view"]
      }
    }
  };
}

function createWorkspaceServiceFixture({
  tenancyMode = "workspace",
  tenancyPolicy = {},
  workspaceRoles = createWorkspaceRoles(),
  additionalWorkspaces = [],
  membershipResolver = null,
  personalWorkspace = {
    id: 1,
    slug: "tonymobily3",
    name: "TonyMobily3",
    ownerUserId: 7,
    isPersonal: true,
    avatarUrl: "",
    color: "#0F6B54"
  }
} = {}) {
  const calls = {
    findPersonalByOwnerUserId: 0,
    listForUserId: 0,
    insert: 0,
    ensureOwnerMembership: 0
  };
  let nextWorkspaceId = 10;
  const personalWorkspaceState =
    personalWorkspace && typeof personalWorkspace === "object" ? { ...personalWorkspace } : null;
  const insertedPayloads = [];

  const workspaceBySlug = new Map();
  if (personalWorkspaceState?.slug) {
    workspaceBySlug.set(String(personalWorkspaceState.slug).trim().toLowerCase(), {
      ...personalWorkspaceState
    });
  }
  for (const workspace of Array.isArray(additionalWorkspaces) ? additionalWorkspaces : []) {
    if (!workspace || typeof workspace !== "object") {
      continue;
    }
    const slug = String(workspace.slug || "").trim().toLowerCase();
    if (!slug) {
      continue;
    }
    workspaceBySlug.set(slug, {
      ...workspace
    });
  }

  const service = createService({
    appConfig: {
      tenancyMode,
      tenancyPolicy,
      workspaceRoles: workspaceRoles && typeof workspaceRoles === "object" ? { ...workspaceRoles } : workspaceRoles
    },
    workspacesRepository: {
      async findBySlug(slug) {
        const normalizedSlug = String(slug || "").trim().toLowerCase();
        const workspace = workspaceBySlug.get(normalizedSlug);
        if (!workspace) {
          return null;
        }
        return { ...workspace };
      },
      async findPersonalByOwnerUserId() {
        calls.findPersonalByOwnerUserId += 1;
        return personalWorkspaceState ? { ...personalWorkspaceState } : null;
      },
      async listForUserId() {
        calls.listForUserId += 1;
        return [
          {
            id: 1,
            slug: "tonymobily3",
            name: "TonyMobily3",
            avatarUrl: "",
            color: "#0F6B54",
            roleId: "owner",
            membershipStatus: "active"
          },
          {
            id: 2,
            slug: "pending-workspace",
            name: "Pending Workspace",
            avatarUrl: "",
            color: "#0F6B54",
            roleId: "member",
            membershipStatus: "pending"
          }
        ];
      },
      async insert(payload) {
        calls.insert += 1;
        insertedPayloads.push(payload);
        const workspaceId = nextWorkspaceId++;
        const inserted = {
          id: workspaceId,
          slug: String(payload.slug || ""),
          name: String(payload.name || ""),
          ownerUserId: Number(payload.ownerUserId),
          isPersonal: payload.isPersonal === true,
          avatarUrl: String(payload.avatarUrl || ""),
          color: String(payload.color || "#0F6B54")
        };
        workspaceBySlug.set(String(inserted.slug).trim().toLowerCase(), inserted);
        return inserted;
      }
    },
    workspaceMembershipsRepository: {
      async ensureOwnerMembership() {
        calls.ensureOwnerMembership += 1;
      },
      async findByWorkspaceIdAndUserId(workspaceId, userId) {
        if (typeof membershipResolver === "function") {
          return membershipResolver(workspaceId, userId);
        }
        return {
          workspaceId,
          userId,
          roleId: "owner",
          status: "active"
        };
      }
    },
    workspaceSettingsRepository: {
      async ensureForWorkspaceId() {
        return {
          invitesEnabled: true
        };
      }
    }
  });

  return { service, calls, insertedPayloads };
}

test("workspaceService no longer exposes bootstrap payload assembly", () => {
  const { service } = createWorkspaceServiceFixture();
  assert.equal(service.buildBootstrapPayload, undefined);
});

test("workspaceService.listWorkspacesForUser returns only accessible workspaces", async () => {
  const { service, calls } = createWorkspaceServiceFixture();
  const workspaces = await service.listWorkspacesForUser({
    id: 7,
    email: "chiaramobily@gmail.com",
    displayName: "Chiara"
  });

  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0].slug, "tonymobily3");
  assert.equal(workspaces[0].roleId, "owner");
  assert.equal(calls.listForUserId, 1);
  assert.equal(calls.insert, 0);
});

test("workspaceService.listWorkspacesForUser no longer provisions personal workspace in workspace mode", async () => {
  const { service, calls } = createWorkspaceServiceFixture({
    tenancyMode: "workspace",
    personalWorkspace: null
  });

  await service.listWorkspacesForUser({
    id: 7,
    email: "chiaramobily@gmail.com",
    displayName: "Chiara"
  });

  assert.equal(calls.findPersonalByOwnerUserId, 0);
  assert.equal(calls.insert, 0);
});

test("workspaceService.provisionWorkspaceForNewUser provisions personal workspace only in personal tenancy", async () => {
  const { service, calls, insertedPayloads } = createWorkspaceServiceFixture({
    tenancyMode: "personal",
    personalWorkspace: null
  });

  const workspace = await service.provisionWorkspaceForNewUser({
    id: 7,
    email: "chiaramobily@gmail.com",
    displayName: "Chiara"
  });

  assert.equal(Number(workspace.ownerUserId), 7);
  assert.equal(calls.findPersonalByOwnerUserId, 1);
  assert.equal(calls.insert, 1);
  assert.equal(calls.ensureOwnerMembership, 1);
  assert.equal(insertedPayloads[0].isPersonal, true);
});

test("workspaceService.provisionWorkspaceForNewUser is a no-op outside personal tenancy", async () => {
  const { service, calls } = createWorkspaceServiceFixture({
    tenancyMode: "workspace"
  });

  const result = await service.provisionWorkspaceForNewUser({
    id: 7,
    email: "chiaramobily@gmail.com",
    displayName: "Chiara"
  });

  assert.equal(result, null);
  assert.equal(calls.insert, 0);
});

test("workspaceService.createWorkspaceForAuthenticatedUser creates non-personal workspace in workspace tenancy", async () => {
  const { service, calls, insertedPayloads } = createWorkspaceServiceFixture({
    tenancyMode: "workspace",
    tenancyPolicy: {
      workspace: {
        allowSelfCreate: true
      }
    }
  });

  const workspace = await service.createWorkspaceForAuthenticatedUser(
    {
      id: 7,
      email: "chiaramobily@gmail.com",
      displayName: "Chiara"
    },
    {
      name: "Operations Team",
      slug: "ops-team"
    }
  );

  assert.equal(workspace.slug, "ops-team");
  assert.equal(calls.insert, 1);
  assert.equal(calls.ensureOwnerMembership, 1);
  assert.equal(insertedPayloads[0].isPersonal, false);
  assert.equal(insertedPayloads[0].ownerUserId, 7);
});

test("workspaceService.createWorkspaceForAuthenticatedUser rejects creation when self-create policy is disabled", async () => {
  const { service } = createWorkspaceServiceFixture({
    tenancyMode: "workspace"
  });

  await assert.rejects(
    () =>
      service.createWorkspaceForAuthenticatedUser(
        {
          id: 7,
          email: "chiaramobily@gmail.com",
          displayName: "Chiara"
        },
        {
          name: "Operations Team"
        }
      ),
    /Workspace creation is disabled for this tenancy mode/
  );
});

test("workspaceService.resolveWorkspaceContextForUserBySlug returns workspace-not-found when requested slug does not exist", async () => {
  const { service } = createWorkspaceServiceFixture({
    tenancyMode: "personal",
    personalWorkspace: null
  });

  await assert.rejects(
    () =>
      service.resolveWorkspaceContextForUserBySlug(
        {
          id: 7,
          email: "chiaramobily@gmail.com",
          displayName: "Chiara"
        },
        "tonymobily3"
      ),
    /Workspace not found/
  );
});

test("workspaceService.resolveWorkspaceContextForUserBySlug allows personal tenancy access when membership is active", async () => {
  const { service } = createWorkspaceServiceFixture({
    tenancyMode: "personal",
    personalWorkspace: {
      id: 1,
      slug: "my-personal",
      name: "My Personal",
      ownerUserId: 7,
      isPersonal: true,
      avatarUrl: "",
      color: "#0F6B54"
    },
    additionalWorkspaces: [
      {
        id: 42,
        slug: "team-alpha",
        name: "Team Alpha",
        ownerUserId: 99,
        isPersonal: false,
        avatarUrl: "",
        color: "#0F6B54"
      }
    ]
  });

  const context = await service.resolveWorkspaceContextForUserBySlug(
    {
      id: 7,
      email: "chiaramobily@gmail.com",
      displayName: "Chiara"
    },
    "team-alpha"
  );

  assert.equal(context.workspace.slug, "team-alpha");
  assert.equal(context.membership.roleId, "owner");
  assert.deepEqual(context.permissions, ["*"]);
});

test("workspaceService.resolveWorkspaceContextForUserBySlug grants owner access even when membership row is missing", async () => {
  let ensuredMembershipCount = 0;
  let membershipRecord = null;

  const service = createService({
    appConfig: {
      tenancyMode: "personal",
      workspaceRoles: createWorkspaceRoles()
    },
    workspacesRepository: {
      async findBySlug(slug) {
        if (String(slug) !== "tonymobily") {
          return null;
        }
        return {
          id: 1,
          slug: "tonymobily",
          name: "TonyMobily",
          ownerUserId: 7,
          isPersonal: true,
          avatarUrl: "",
          color: "#0F6B54"
        };
      },
      async findPersonalByOwnerUserId() {
        return null;
      },
      async listForUserId() {
        return [];
      },
      async insert() {
        throw new Error("not implemented");
      }
    },
    workspaceMembershipsRepository: {
      async findByWorkspaceIdAndUserId() {
        return membershipRecord;
      },
      async ensureOwnerMembership(workspaceId, userId) {
        ensuredMembershipCount += 1;
        membershipRecord = {
          workspaceId,
          userId,
          roleId: "owner",
          status: "active"
        };
        return membershipRecord;
      }
    },
    workspaceSettingsRepository: {
      async ensureForWorkspaceId() {
        return {
          invitesEnabled: true
        };
      }
    }
  });

  const context = await service.resolveWorkspaceContextForUserBySlug(
    {
      id: 7,
      email: "chiaramobily@gmail.com",
      displayName: "Chiara"
    },
    "tonymobily"
  );

  assert.equal(ensuredMembershipCount, 1);
  assert.equal(context.membership.roleId, "owner");
  assert.deepEqual(context.permissions, ["*"]);
});

test("workspaceService.resolveWorkspaceContextForUserBySlug resolves permissions from appConfig.workspaceRoles", async () => {
  const { service } = createWorkspaceServiceFixture({
    workspaceRoles: {
      defaultInviteRole: "member",
      roles: {
        owner: {
          assignable: false,
          permissions: ["workspace.settings.update"]
        }
      }
    }
  });

  const context = await service.resolveWorkspaceContextForUserBySlug(
    {
      id: 7,
      email: "chiaramobily@gmail.com",
      displayName: "Chiara"
    },
    "tonymobily3"
  );

  assert.deepEqual(context.permissions, ["workspace.settings.update"]);
});
