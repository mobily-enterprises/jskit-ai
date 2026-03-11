import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server/common/services/workspaceContextService.js";

function createWorkspaceServiceFixture({ tenancyMode = "workspace" } = {}) {
  const service = createService({
    appConfig: {
      tenancyMode
    },
    workspacesRepository: {
      async findBySlug() {
        return {
          id: 1,
          slug: "tonymobily3",
          name: "TonyMobily3",
          avatarUrl: "",
          color: "#0F6B54"
        };
      },
      async findPersonalByOwnerUserId() {
        return {
          id: 1,
          slug: "tonymobily3",
          name: "TonyMobily3",
          avatarUrl: "",
          color: "#0F6B54"
        };
      },
      async listForUserId() {
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
      async insert() {
        return {
          id: 1,
          slug: "tonymobily3",
          name: "TonyMobily3",
          avatarUrl: "",
          color: "#0F6B54"
        };
      }
    },
    workspaceMembershipsRepository: {
      async ensureOwnerMembership() {},
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

  return { service };
}

test("workspaceService no longer exposes bootstrap payload assembly", () => {
  const { service } = createWorkspaceServiceFixture();
  assert.equal(service.buildBootstrapPayload, undefined);
});

test("workspaceService.listWorkspacesForUser returns only accessible workspaces", async () => {
  const { service } = createWorkspaceServiceFixture();
  const workspaces = await service.listWorkspacesForUser({
    id: 7,
    email: "chiaramobily@gmail.com",
    displayName: "Chiara"
  });

  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0].slug, "tonymobily3");
  assert.equal(workspaces[0].roleId, "owner");
});
