import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceActionContextContributor } from "../src/server/common/contributors/workspaceActionContextContributor.js";
import { createWorkspaceAuthPolicyContextResolver } from "../src/server/common/contributors/workspaceAuthPolicyContextResolver.js";
import { buildWorkspaceName, createService } from "../src/server/common/services/workspaceDirectoryService.js";
import { createWorkspaceRoleCatalog } from "../src/shared/roles.js";
import { resolveTenancyProfile } from "../src/shared/tenancyProfile.js";

// The service receives what the workspaces feature resolves from its config.
function resolvedSettings(appConfig) {
  return {
    tenancyProfile: resolveTenancyProfile(appConfig),
    roleCatalog: createWorkspaceRoleCatalog(appConfig),
    personalWorkspaceName: appConfig.personalWorkspaceName ?? buildWorkspaceName
  };
}

function createRoleCatalog() {
  return {
    workspace: {
      defaultInviteRole: "member"
    },
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
  tenancyMode = "workspaces",
  tenancyPolicy = {},
  roleCatalog = createRoleCatalog(),
  additionalWorkspaces = [],
  userWorkspaceRows = null,
  membershipResolver = null,
  personalWorkspaceName = undefined,
  personalWorkspace = {
    id: "1",
    slug: "tony3",
    name: "Tony3",
    ownerUserId: "7",
    isPersonal: true,
    avatarUrl: ""
  }
} = {}) {
  const calls = {
    findBySlug: 0,
    listSlugsIn: 0,
    findPersonalByOwnerUserId: 0,
    listForUserId: 0,
    insert: 0,
    updateById: 0,
    ensureOwnerMembership: 0,
    ensureWorkspaceSettings: 0
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
    ...resolvedSettings({
      tenancyMode,
      tenancyPolicy,
      personalWorkspaceName,
      roleCatalog: roleCatalog && typeof roleCatalog === "object" ? { ...roleCatalog } : roleCatalog
    }),
    workspacesRepository: {
      async findBySlug(slug) {
        calls.findBySlug += 1;
        const normalizedSlug = String(slug || "").trim().toLowerCase();
        const workspace = workspaceBySlug.get(normalizedSlug);
        if (!workspace) {
          return null;
        }
        return { ...workspace };
      },
      async listSlugsIn(slugs) {
        calls.listSlugsIn += 1;
        return new Set(slugs.filter((slug) => workspaceBySlug.has(String(slug).trim().toLowerCase())));
      },
      async findPersonalByOwnerUserId() {
        calls.findPersonalByOwnerUserId += 1;
        return personalWorkspaceState ? { ...personalWorkspaceState } : null;
      },
      async listForUserId() {
        calls.listForUserId += 1;
        if (Array.isArray(userWorkspaceRows)) {
          return userWorkspaceRows;
        }
        return [
          {
            id: "1",
            slug: "tony3",
            name: "Tony3",
            avatarUrl: "",
            roleSid: "owner",
            membershipStatus: "active"
          },
          {
            id: "2",
            slug: "pending-workspace",
            name: "Pending Workspace",
            avatarUrl: "",
            roleSid: "member",
            membershipStatus: "pending"
          }
        ];
      },
      async insert(payload) {
        calls.insert += 1;
        insertedPayloads.push(payload);
        const workspaceId = String(nextWorkspaceId++);
        const inserted = {
          id: workspaceId,
          slug: String(payload.slug || ""),
          name: String(payload.name || ""),
          ownerUserId: String(payload.ownerUserId || ""),
          isPersonal: payload.isPersonal === true,
          avatarUrl: String(payload.avatarUrl || "")
        };
        workspaceBySlug.set(String(inserted.slug).trim().toLowerCase(), inserted);
        return inserted;
      },
      async updateById(workspaceId, patch) {
        calls.updateById += 1;
        const targetId = String(workspaceId || "").trim();
        for (const [slug, workspace] of workspaceBySlug.entries()) {
          if (String(workspace.id || "").trim() !== targetId) {
            continue;
          }
          const updated = {
            ...workspace
          };
          if (Object.hasOwn(patch, "name")) {
            updated.name = String(patch.name || "");
          }
          if (Object.hasOwn(patch, "avatarUrl")) {
            updated.avatarUrl = String(patch.avatarUrl || "");
          }
          workspaceBySlug.set(slug, updated);
          return {
            ...updated
          };
        }
        return null;
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
          roleSid: "owner",
          status: "active"
        };
      }
    },
    workspaceSettingsRepository: {
      async ensureForWorkspaceId() {
        calls.ensureWorkspaceSettings += 1;
        return {
          invitesEnabled: true
        };
      }
    }
  });

  return { service, calls, insertedPayloads };
}

test("workspaceService keeps bootstrap payload assembly outside its API", () => {
  const { service } = createWorkspaceServiceFixture();
  assert.equal(service.buildBootstrapPayload, undefined);
});

test("workspaceService.listWorkspacesForUser returns only accessible workspaces", async () => {
  const { service, calls } = createWorkspaceServiceFixture();
  const workspaces = await service.listWorkspacesForUser({
    id: "7",
    email: "chiara@example.com",
    displayName: "Chiara"
  });

  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0].slug, "tony3");
  assert.equal(workspaces[0].roleSid, "owner");
  assert.equal(calls.listForUserId, 1);
  assert.equal(calls.insert, 0);
});

test("workspaceService.listWorkspacesForUser does not provision a personal workspace in workspace mode", async () => {
  const { service, calls } = createWorkspaceServiceFixture({
    tenancyMode: "workspaces",
    personalWorkspace: null
  });

  await service.listWorkspacesForUser({
    id: "7",
    email: "chiara@example.com",
    displayName: "Chiara"
  });

  assert.equal(calls.findPersonalByOwnerUserId, 0);
  assert.equal(calls.insert, 0);
});

test("workspaceService.listWorkspacesForUser returns all active memberships in personal tenancy", async () => {
  const { service, calls } = createWorkspaceServiceFixture({
    tenancyMode: "personal",
    userWorkspaceRows: [
      {
        id: "1",
        slug: "chiara",
        name: "Chiara Personal",
        avatarUrl: "",
        roleSid: "owner",
        membershipStatus: "active"
      },
      {
        id: "2",
        slug: "tony",
        name: "Tony Workspace",
        avatarUrl: "",
        roleSid: "member",
        membershipStatus: "active"
      },
      {
        id: "3",
        slug: "pending-workspace",
        name: "Pending Workspace",
        avatarUrl: "",
        roleSid: "member",
        membershipStatus: "pending"
      }
    ]
  });

  const workspaces = await service.listWorkspacesForUser({
    id: "7",
    email: "chiara@example.com",
    displayName: "Chiara"
  });

  assert.deepEqual(
    workspaces.map((workspace) => workspace.slug),
    ["chiara", "tony"]
  );
  assert.equal(calls.findPersonalByOwnerUserId, 0);
  assert.equal(calls.listForUserId, 1);
});

test("workspaceService.ensureProvisionedWorkspaceForAuthenticatedUser provisions personal workspace only in personal tenancy", async () => {
  const { service, calls, insertedPayloads } = createWorkspaceServiceFixture({
    tenancyMode: "personal",
    personalWorkspace: null
  });

  const workspace = await service.ensureProvisionedWorkspaceForAuthenticatedUser({
    id: "7",
    email: "chiara@example.com",
    displayName: "Chiara"
  });

  assert.equal(Number(workspace.ownerUserId), 7);
  assert.equal(calls.findPersonalByOwnerUserId, 1);
  assert.equal(calls.insert, 1);
  assert.equal(calls.ensureOwnerMembership, 1);
  assert.equal(calls.ensureWorkspaceSettings, 1);
  assert.equal(insertedPayloads[0].isPersonal, true);
  assert.equal(insertedPayloads[0].name, "Chiara's Workspace");
});

test("workspaceService.ensureProvisionedWorkspaceForAuthenticatedUser provisions a named personal workspace when workspace tenancy opts in", async () => {
  const { service, calls, insertedPayloads } = createWorkspaceServiceFixture({
    tenancyMode: "workspaces",
    tenancyPolicy: {
      workspace: {
        autoProvision: true
      }
    },
    personalWorkspaceName: (user) => `${user.displayName}'s home`,
    personalWorkspace: null
  });

  const workspace = await service.ensureProvisionedWorkspaceForAuthenticatedUser({
    id: "7",
    email: "chiara@example.com",
    displayName: "Chiara"
  });

  assert.equal(Number(workspace.ownerUserId), 7);
  assert.equal(calls.insert, 1);
  assert.equal(calls.ensureOwnerMembership, 1);
  assert.equal(insertedPayloads[0].isPersonal, true);
  assert.equal(insertedPayloads[0].name, "Chiara's home");
});

test("workspaceService.ensureProvisionedWorkspaceForAuthenticatedUser reuses the existing personal workspace in personal tenancy", async () => {
  const { service, calls } = createWorkspaceServiceFixture({
    tenancyMode: "personal"
  });

  const workspace = await service.ensureProvisionedWorkspaceForAuthenticatedUser({
    id: "7",
    email: "chiara@example.com",
    displayName: "Chiara"
  });

  assert.equal(workspace.id, "1");
  assert.equal(calls.findPersonalByOwnerUserId, 1);
  assert.equal(calls.insert, 0);
  assert.equal(calls.ensureOwnerMembership, 1);
  assert.equal(calls.ensureWorkspaceSettings, 1);
});

test("workspaceService.ensureProvisionedWorkspaceForAuthenticatedUser is a no-op outside personal tenancy", async () => {
  const { service, calls } = createWorkspaceServiceFixture({
    tenancyMode: "workspaces"
  });

  const result = await service.ensureProvisionedWorkspaceForAuthenticatedUser({
    id: "7",
    email: "chiara@example.com",
    displayName: "Chiara"
  });

  assert.equal(result, null);
  assert.equal(calls.insert, 0);
});

test("workspaceService.createWorkspaceForAuthenticatedUser creates non-personal workspace in workspace tenancy", async () => {
  const { service, calls, insertedPayloads } = createWorkspaceServiceFixture({
    tenancyMode: "workspaces",
    tenancyPolicy: {
      workspace: {
        allowSelfCreate: true
      }
    }
  });

  const workspace = (await service.createWorkspaceForAuthenticatedUser(
    {
      id: "7",
      email: "chiara@example.com",
      displayName: "Chiara"
    },
    {
      name: "Operations Team",
      slug: "ops-team"
    }
  )).value;

  assert.equal(workspace.slug, "ops-team");
  assert.equal(calls.insert, 1);
  assert.equal(calls.ensureOwnerMembership, 1);
  assert.equal(calls.ensureWorkspaceSettings, 1);
  assert.equal(insertedPayloads[0].isPersonal, false);
  assert.equal(insertedPayloads[0].ownerUserId, "7");
});

test("workspaceService.createWorkspaceForAuthenticatedUser generates an omitted slug and provisions ownership", async () => {
  const { service, calls, insertedPayloads } = createWorkspaceServiceFixture({
    tenancyMode: "workspaces",
    tenancyPolicy: {
      workspace: {
        allowSelfCreate: true
      }
    }
  });

  const workspace = (await service.createWorkspaceForAuthenticatedUser(
    {
      id: "7",
      email: "chiara@example.com",
      displayName: "Chiara"
    },
    {
      name: "Operations Team"
    }
  )).value;

  assert.equal(workspace.slug, "operations-team");
  assert.equal(calls.insert, 1);
  assert.equal(calls.ensureOwnerMembership, 1);
  assert.equal(calls.ensureWorkspaceSettings, 1);
  assert.equal(insertedPayloads[0].slug, "operations-team");
  assert.equal(insertedPayloads[0].isPersonal, false);
  assert.equal(insertedPayloads[0].ownerUserId, "7");
});

// The slug a new workspace named `name` gets while `takenSlugs` are held, and how many reads chose it.
async function chooseWorkspaceSlug(name, takenSlugs) {
  const { service, calls } = createWorkspaceServiceFixture({
    tenancyMode: "workspaces",
    tenancyPolicy: { workspace: { allowSelfCreate: true } },
    personalWorkspace: null,
    additionalWorkspaces: takenSlugs.map((slug, index) => ({
      id: String(1000 + index), slug, name: slug, ownerUserId: "8", isPersonal: false, avatarUrl: ""
    }))
  });
  const workspace = (await service.createWorkspaceForAuthenticatedUser({ id: "7" }, { name })).value;
  assert.equal(calls.listSlugsIn, 1);
  return workspace.slug;
}

test("workspaceService chooses the first free slug of base, base-2 to base-1000 in one read", async () => {
  assert.equal(await chooseWorkspaceSlug("Acme", []), "acme");
  assert.equal(await chooseWorkspaceSlug("Acme", ["acme"]), "acme-2");
  assert.equal(
    await chooseWorkspaceSlug("Acme", ["acme", "acme-2", "acme-4", "acme-5"]),
    "acme-3"
  );
  assert.equal(await chooseWorkspaceSlug("Acme", ["acme-2"]), "acme");

  const longName = "a".repeat(60);
  const trimmedBase = "a".repeat(48);
  assert.equal(await chooseWorkspaceSlug(longName, []), trimmedBase);
  assert.equal(await chooseWorkspaceSlug(longName, [trimmedBase]), `${trimmedBase}-2`);
});

test("workspaceService fails the same way when base to base-1000 are all taken", async () => {
  const taken = ["acme", ...Array.from({ length: 999 }, (_, index) => `acme-${index + 2}`)];
  await assert.rejects(chooseWorkspaceSlug("Acme", taken), /Unable to generate unique workspace slug\./);
  assert.equal(await chooseWorkspaceSlug("Acme", taken.slice(0, -1)), "acme-1000");
});

test("workspaceService.createWorkspaceForAuthenticatedUser rejects creation when self-create policy is disabled", async () => {
  const { service } = createWorkspaceServiceFixture({
    tenancyMode: "workspaces"
  });

  await assert.rejects(
    () =>
      service.createWorkspaceForAuthenticatedUser(
        {
          id: "7",
          email: "chiara@example.com",
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
          id: "7",
          email: "chiara@example.com",
          displayName: "Chiara"
        },
        "tony3"
      ),
    /Workspace not found/
  );
});

test("workspaceService.resolveWorkspaceContextForUserBySlug allows personal tenancy access when membership is active", async () => {
  const { service } = createWorkspaceServiceFixture({
    tenancyMode: "personal",
    personalWorkspace: {
      id: "1",
      slug: "my-personal",
      name: "My Personal",
      ownerUserId: "7",
      isPersonal: true,
      avatarUrl: ""
    },
    additionalWorkspaces: [
      {
        id: "42",
        slug: "team-alpha",
        name: "Team Alpha",
        ownerUserId: "99",
        isPersonal: false,
        avatarUrl: ""
      }
    ]
  });

  const context = await service.resolveWorkspaceContextForUserBySlug(
    {
      id: "7",
      email: "chiara@example.com",
      displayName: "Chiara"
    },
    "team-alpha"
  );

  assert.equal(context.workspace.slug, "team-alpha");
  assert.equal(context.membership.roleSid, "owner");
  assert.deepEqual(context.permissions, ["*"]);
});

test("workspaceService.resolveWorkspaceContextForUserBySlug grants owner access even when membership row is missing", async () => {
  let ensuredMembershipCount = 0;
  let membershipRecord = null;

  const service = createService({
    ...resolvedSettings({
      tenancyMode: "personal",
      roleCatalog: createRoleCatalog()
    }),
    workspacesRepository: {
      async findBySlug(slug) {
        if (String(slug) !== "tony") {
          return null;
        }
        return {
          id: "1",
          slug: "tony",
          name: "Tony",
          ownerUserId: "7",
          isPersonal: true,
          avatarUrl: ""
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
          roleSid: "owner",
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
      id: "7",
      email: "chiara@example.com",
      displayName: "Chiara"
    },
    "tony"
  );

  assert.equal(ensuredMembershipCount, 1);
  assert.equal(context.membership.roleSid, "owner");
  assert.deepEqual(context.permissions, ["*"]);
});

test("workspaceService.resolveWorkspaceContextForUserBySlug can resolve an existing workspace without membership", async () => {
  const service = createService({
    ...resolvedSettings({
      tenancyMode: "personal",
      roleCatalog: createRoleCatalog()
    }),
    workspacesRepository: {
      async findBySlug() {
        return {
          id: "42",
          slug: "dog-and-groom",
          name: "Harbor Grooming",
          ownerUserId: "99",
          isPersonal: false,
          avatarUrl: ""
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
        return null;
      },
      async ensureOwnerMembership() {
        throw new Error("must not create membership for a non-owner");
      }
    },
    workspaceSettingsRepository: {
      async ensureForWorkspaceId() {
        return { invitesEnabled: true };
      }
    }
  });

  await assert.rejects(
    () =>
      service.resolveWorkspaceContextForUserBySlug(
        { id: "7", email: "customer@example.com" },
        "dog-and-groom"
      ),
    /You do not have access to this workspace/
  );

  const context = await service.resolveWorkspaceContextForUserBySlug(
    { id: "7", email: "customer@example.com" },
    "dog-and-groom",
    { requireMembership: false }
  );

  assert.equal(context.workspace.slug, "dog-and-groom");
  assert.equal(context.membership, null);
  assert.deepEqual(context.permissions, []);
});

test("workspaceService.resolveWorkspaceContextForUserBySlug resolves permissions from appConfig.roleCatalog", async () => {
  const { service } = createWorkspaceServiceFixture({
    roleCatalog: {
      workspace: {
        defaultInviteRole: "member"
      },
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
      id: "7",
      email: "chiara@example.com",
      displayName: "Chiara"
    },
    "tony3"
  );

  assert.deepEqual(context.permissions, ["workspace.settings.update"]);
});

test("one request's auth policy and action context share one workspace context resolution", async () => {
  const { service, calls } = createWorkspaceServiceFixture({
    additionalWorkspaces: [{ id: "42", slug: "team-alpha", name: "Team Alpha", ownerUserId: "99", isPersonal: false, avatarUrl: "" }]
  });
  const resolvePolicy = createWorkspaceAuthPolicyContextResolver({ workspaceService: service, workspaceMembershipOptionalSurfaceIds: [] });
  const contributor = createWorkspaceActionContextContributor({
    workspaceService: service,
    workspaceMembershipOptionalSurfaceIds: [],
    workspaceSurfaceIds: ["admin"]
  });
  const user = { id: "7", email: "chiara@example.com", displayName: "Chiara" };
  const handle = async () => {
    const request = { user, params: { workspaceSlug: "team-alpha" } };
    const policy = await resolvePolicy({ request, actor: user, meta: { permission: "workspace.settings.update" } });
    const action = await contributor.contribute({
      definition: { id: "workspace.settings.update", surfaces: ["admin"] },
      input: { workspaceSlug: "Team-Alpha" },
      context: { requestMeta: { request } }
    });
    return { policy, action };
  };

  const { policy, action } = await handle();
  assert.equal(calls.findBySlug, 1, "The action context reuses the auth policy's resolution");
  assert.equal(calls.ensureWorkspaceSettings, 1);
  assert.equal(action.requestMeta.resolvedWorkspaceContext.workspace, policy.workspace);
  assert.deepEqual(action.requestMeta.resolvedWorkspaceContext.workspaceSettings, { invitesEnabled: true });
  assert.deepEqual(action.permissions, policy.permissions);

  await handle();
  assert.equal(calls.findBySlug, 2, "The next request resolves again");
  await service.resolveWorkspaceContextForUserBySlug(user, "team-alpha");
  await service.resolveWorkspaceContextForUserBySlug(user, "team-alpha");
  assert.equal(calls.findBySlug, 4, "A call without a request resolves each time");
  const request = {};
  await service.resolveWorkspaceContextForUserBySlug(user, "team-alpha", { request });
  await service.resolveWorkspaceContextForUserBySlug(user, "team-alpha", { request, requireMembership: false });
  await service.resolveWorkspaceContextForUserBySlug({ ...user, id: "8" }, "team-alpha", { request });
  await service.resolveWorkspaceContextForUserBySlug(user, "team-alpha", { request, trx: {} });
  assert.equal(calls.findBySlug, 8, "Another membership requirement, user or a transaction resolves on its own");
});

test("workspaceService.getWorkspaceForAuthenticatedUser resolves workspace from slug context", async () => {
  const { service } = createWorkspaceServiceFixture({
    additionalWorkspaces: [
      {
        id: "42",
        slug: "team-alpha",
        name: "Team Alpha",
        ownerUserId: "99",
        isPersonal: false,
        avatarUrl: ""
      }
    ]
  });

  const workspace = (await service.getWorkspaceForAuthenticatedUser(
    {
      id: "7",
      email: "chiara@example.com",
      displayName: "Chiara"
    },
    "team-alpha"
  )).value;

  assert.equal(workspace.slug, "team-alpha");
  assert.equal(workspace.name, "Team Alpha");
});

test("workspaceService.updateWorkspaceForAuthenticatedUser updates workspace profile fields", async () => {
  const { service, calls } = createWorkspaceServiceFixture();

  const workspace = (await service.updateWorkspaceForAuthenticatedUser(
    {
      id: "7",
      email: "chiara@example.com",
      displayName: "Chiara"
    },
    "tony3",
    {
      name: "Updated Workspace",
      avatarUrl: "https://example.com/acme.png"
    }
  )).value;

  assert.equal(calls.updateById, 1);
  assert.equal(workspace.name, "Updated Workspace");
  assert.equal(workspace.avatarUrl, "https://example.com/acme.png");
});
