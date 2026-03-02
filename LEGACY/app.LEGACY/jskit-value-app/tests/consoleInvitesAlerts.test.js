import assert from "node:assert/strict";
import test from "node:test";

import { createConsoleInvitesService } from "@jskit-ai/workspace-console-service-core/services/consoleInvites";

function createConsoleInvitesFixture({ alertsService } = {}) {
  const state = {
    nextInviteId: 100,
    invites: [],
    alertCalls: []
  };

  const service = createConsoleInvitesService({
    async requirePermission() {},
    async runInInviteTransaction(work) {
      return work(null);
    },
    consoleInvitesRepository: {
      async listPendingByEmail(email) {
        const normalizedEmail = String(email || "")
          .trim()
          .toLowerCase();
        return state.invites.filter((invite) => String(invite.email || "").toLowerCase() === normalizedEmail);
      },
      async listPending() {
        return state.invites.slice();
      },
      async expirePendingByEmail() {
        return 0;
      },
      async insert(payload) {
        const nextInvite = {
          id: state.nextInviteId++,
          email: String(payload?.email || ""),
          roleId: String(payload?.roleId || ""),
          status: "pending",
          tokenHash: String(payload?.tokenHash || ""),
          invitedByUserId: payload?.invitedByUserId == null ? null : Number(payload.invitedByUserId),
          expiresAt: String(payload?.expiresAt || ""),
          invitedBy: {
            displayName: "Actor",
            email: "actor@example.com"
          }
        };
        state.invites.push(nextInvite);
        return nextInvite;
      },
      async findPendingById() {
        return null;
      },
      async findPendingByTokenHash() {
        return null;
      },
      async revokeById() {
        return null;
      },
      async markAcceptedById() {
        return null;
      }
    },
    consoleMembershipsRepository: {
      async findByUserId() {
        return null;
      },
      async ensureActiveByUserId() {
        return null;
      }
    },
    userProfilesRepository: {
      async findByEmail(email) {
        const normalized = String(email || "")
          .trim()
          .toLowerCase();
        if (normalized !== "existing@example.com") {
          return null;
        }

        return {
          id: 42,
          email: "existing@example.com"
        };
      }
    },
    roleCatalog: {
      defaultInviteRole: "member",
      roles: [],
      assignableRoleIds: ["member"]
    },
    normalizeRoleForAssignment(roleId) {
      return String(roleId || "member").trim() || "member";
    },
    alertsService:
      alertsService ||
      ({
        async createConsoleInviteAlert(payload) {
          state.alertCalls.push(payload);
        }
      })
  });

  return {
    state,
    service
  };
}

test("console invites service creates invite alerts for existing users", async () => {
  const { service, state } = createConsoleInvitesFixture();

  const response = await service.createInvite(
    {
      id: 7,
      email: "actor@example.com"
    },
    {
      email: "existing@example.com",
      roleId: "member"
    }
  );

  assert.equal(typeof response.createdInvite?.token, "string");
  assert.equal(response.createdInvite.token.length > 0, true);
  assert.equal(state.alertCalls.length, 1);
  assert.equal(state.alertCalls[0].userId, 42);
  assert.equal(state.alertCalls[0].roleId, "member");
  assert.equal(state.alertCalls[0].actorUserId, 7);
});

test("console invites service keeps invite creation successful when alerts fail", async () => {
  const { service } = createConsoleInvitesFixture({
    alertsService: {
      async createConsoleInviteAlert() {
        throw new Error("alerts offline");
      }
    }
  });

  const response = await service.createInvite(
    {
      id: 7,
      email: "actor@example.com"
    },
    {
      email: "existing@example.com",
      roleId: "member"
    }
  );

  assert.equal(typeof response.createdInvite?.token, "string");
  assert.equal(response.createdInvite.token.length > 0, true);
  assert.equal(
    response.invites.some((invite) => invite.email === "existing@example.com"),
    true
  );
});

