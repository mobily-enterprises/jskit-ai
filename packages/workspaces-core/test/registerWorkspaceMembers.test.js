import assert from "node:assert/strict";
import test from "node:test";
import { registerWorkspaceMembers } from "../src/server/workspaceMembers/registerWorkspaceMembers.js";

function createAppDouble() {
  const serviceCalls = [];

  return {
    serviceCalls,
    app: {
      singleton() {
        return this;
      },
      service(token, factory, metadata) {
        serviceCalls.push({
          token,
          factory,
          metadata
        });
        return this;
      },
      actions() {
        return this;
      }
    }
  };
}

function createScopeDouble(bindings = {}) {
  return {
    has(token) {
      return Object.hasOwn(bindings, token);
    },
    make(token) {
      if (!Object.hasOwn(bindings, token)) {
        throw new Error(`Missing test binding: ${token}`);
      }
      const binding = bindings[token];
      return typeof binding === "function" && token !== "appConfig" ? binding(this) : binding;
    }
  };
}

test("registerWorkspaceMembers uses app-owned workspace invite email template from appConfig", async () => {
  const templateCalls = [];
  const mailerCalls = [];
  const fixture = createAppDouble();
  registerWorkspaceMembers(fixture.app);
  const serviceCall = fixture.serviceCalls.find((entry) => entry.token === "workspaces.members.service");

  const service = serviceCall.factory(createScopeDouble({
    appConfig: {
      workspaceMembers: {
        defaults: {
          inviteExpiresInMs: 60_000
        }
      },
      roleCatalog: {
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
            permissions: ["workspace.members.view"]
          }
        }
      },
      workspaceInviteEmailTemplate(payload) {
        templateCalls.push(payload);
        return {
          subject: "Custom invite",
          text: payload.inviteUrl,
          html: null
        };
      }
    },
    "jskit.env": {
      APP_PUBLIC_URL: "https://app.example.test"
    },
    "workspaces.invitations.enabled": true,
    "workspaces.invite.mailer": {
      async sendWorkspaceInvite(payload) {
        mailerCalls.push(payload);
        return {
          status: "sent",
          message: "sent",
          providerMessageId: "msg-custom"
        };
      }
    },
    "internal.repository.workspace-memberships": {
      async listActiveByWorkspaceId() {
        return [];
      }
    },
    "internal.repository.workspace-invites": {
      async listPendingByWorkspaceIdWithWorkspace() {
        return [];
      },
      async expirePendingByWorkspaceIdAndEmail() {},
      async insert(payload) {
        return {
          id: "91",
          expiresAt: payload.expiresAt
        };
      },
      async findPendingByIdForWorkspace() {
        return null;
      },
      async revokeById() {}
    }
  }));

  const result = await service.createInvite(
    {
      id: "7",
      slug: "acme",
      name: "Acme",
      ownerUserId: "9",
      avatarUrl: ""
    },
    { id: "9", email: "owner@example.com" },
    {
      email: "invitee@example.com",
      roleSid: "member"
    }
  );

  assert.equal(result.inviteDelivery.providerMessageId, "msg-custom");
  assert.equal(templateCalls.length, 1);
  assert.equal(templateCalls[0].workspace.name, "Acme");
  assert.equal(mailerCalls.length, 1);
  assert.equal(mailerCalls[0].message.subject, "Custom invite");
  assert.match(mailerCalls[0].inviteUrl, /^https:\/\/app\.example\.test\/invite\//);
});
