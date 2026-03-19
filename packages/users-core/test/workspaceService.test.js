import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server/common/services/workspaceContextService.js";

function createWorkspaceServiceFixture({
  tenancyMode = "workspace",
  tenancyPolicy = {},
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
  const takenSlugs = new Set(["tonymobily3"]);
  if (personalWorkspaceState?.slug) {
    takenSlugs.add(String(personalWorkspaceState.slug).trim().toLowerCase());
  }

  const service = createService({
    appConfig: {
      tenancyMode,
      tenancyPolicy
    },
    workspacesRepository: {
      async findBySlug(slug) {
        const normalizedSlug = String(slug || "").trim().toLowerCase();
        if (!takenSlugs.has(normalizedSlug)) {
          return null;
        }
        return {
          id: 1,
          slug: normalizedSlug,
          name: "TonyMobily3",
          avatarUrl: "",
          color: "#0F6B54"
        };
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
        takenSlugs.add(String(inserted.slug).trim().toLowerCase());
        return inserted;
      }
    },
    workspaceMembershipsRepository: {
      async ensureOwnerMembership() {
        calls.ensureOwnerMembership += 1;
      },
      async findByWorkspaceIdAndUserId() {
        return {
          workspaceId: 1,
          userId: 1,
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

test("workspaceService.resolveWorkspaceContextForUserBySlug rejects personal tenancy when personal workspace is missing", async () => {
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
    /Personal workspace not found/
  );
});
