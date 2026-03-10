import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server/workspace/workspaceService.js";

function createWorkspaceServiceFixture({
  tenancyMode = "workspace"
} = {}) {
  const workspace = {
    id: 1,
    slug: "tonymobily3",
    name: "TonyMobily3",
    avatarUrl: "",
    color: "#0F6B54"
  };

  const service = createService({
    appConfig: {
      tenancyMode
    },
    workspacesRepository: {
      async findBySlug(slug) {
        return String(slug || "").trim().toLowerCase() === "tonymobily3" ? workspace : null;
      },
      async findPersonalByOwnerUserId() {
        return null;
      },
      async insert() {
        return workspace;
      },
      async listForUserId() {
        return [];
      },
      async findById(id) {
        return Number(id) === 1 ? workspace : null;
      }
    },
    workspaceMembershipsRepository: {
      async ensureOwnerMembership() {},
      async findByWorkspaceIdAndUserId(workspaceId, userId) {
        if (Number(workspaceId) !== 1 || Number(userId) < 1) {
          return null;
        }

        return {
          workspaceId: 1,
          userId: Number(userId),
          roleId: "member",
          status: "active"
        };
      },
      async upsertMembership(workspaceId, userId, payload) {
        upsertCalls.push({
          workspaceId: Number(workspaceId),
          userId: Number(userId),
          payload: payload && typeof payload === "object" ? { ...payload } : payload
        });
      }
    },
    workspaceSettingsRepository: {
      async ensureForWorkspaceId() {
        return {
          invitesEnabled: true
        };
      }
    },
    userSettingsRepository: {
      async ensureForUserId() {
        return {
          avatarSize: 64,
          theme: "system",
          locale: "en",
          timeZone: "UTC",
          dateFormat: "yyyy-mm-dd",
          numberFormat: "1,234.56",
          currencyCode: "USD",
          productUpdates: true,
          accountActivity: true,
          securityAlerts: true
        };
      }
    },
    userProfilesRepository: {
      async findByIdentity() {
        return null;
      }
    }
  });

  return {
    service
  };
}

test("buildBootstrapPayload returns pendingInvites provided by the caller", async () => {
  const { service } = createWorkspaceServiceFixture();

  const response = await service.buildBootstrapPayload({
    user: {
      id: 7,
      email: "chiaramobily@gmail.com",
      displayName: "Chiara"
    },
    pendingInvites: [{ id: 44, token: "opaque-token" }]
  });

  assert.deepEqual(response.pendingInvites, [{ id: 44, token: "opaque-token" }]);
});
