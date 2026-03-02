import assert from "node:assert/strict";
import test from "node:test";

import {
  createService as createWorkspaceInviteEmailService,
  __testables
} from "@jskit-ai/workspace-service-core/services/inviteEmail";

test("workspace invite email service skips delivery when not configured", async () => {
  const service = createWorkspaceInviteEmailService({});

  const invalidRecipient = await service.sendWorkspaceInviteEmail({ email: "" });
  assert.deepEqual(invalidRecipient, {
    delivered: false,
    reason: "invalid_recipient"
  });

  const result = await service.sendWorkspaceInviteEmail({
    email: "invitee@example.com",
    workspace: {
      name: "Acme Workspace"
    },
    invitedBy: {
      displayName: "Owner"
    },
    roleId: "member",
    metadata: "invalid"
  });

  assert.equal(result.delivered, false);
  assert.equal(result.reason, "not_configured");
  assert.equal(result.provider, null);
  assert.equal(result.messageId, null);
  assert.equal(result.message.subject.includes("Acme Workspace"), true);
  assert.equal(result.message.text.includes("Role: member"), true);
  assert.equal(result.message.text.includes("Invited by: Owner"), true);
});

test("workspace invite email service delegates sends through injected email sender", async () => {
  const calls = [];
  const service = createWorkspaceInviteEmailService({
    appPublicUrl: "http://localhost:5173",
    sendEmail: async (payload) => {
      calls.push(payload);
      return {
        sent: false,
        reason: "not_implemented",
        provider: "none",
        messageId: null
      };
    }
  });

  const result = await service.sendWorkspaceInviteEmail({
    email: "invitee@example.com",
    workspace: {
      name: "Acme Workspace"
    },
    invitedBy: {
      displayName: "Owner"
    },
    roleId: "admin",
    metadata: {
      source: "workspace_invites"
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, "invitee@example.com");
  assert.equal(calls[0].subject.includes("Acme Workspace"), true);
  assert.equal(calls[0].text.includes("Role: admin"), true);
  assert.deepEqual(calls[0].metadata, {
    source: "workspace_invites"
  });
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "not_implemented");
  assert.equal(result.provider, "none");
  assert.equal(result.messageId, null);
  assert.equal(result.message.subject.includes("Acme Workspace"), true);
  assert.equal(result.message.text.includes("Role: admin"), true);
  assert.equal(result.message.text.includes("Invited by: Owner"), true);
  assert.equal(result.message.text.includes("http://localhost:5173/workspaces"), true);
});

test("workspace invite email service marks sender exceptions as provider_error", async () => {
  const service = createWorkspaceInviteEmailService({
    sendEmail: async () => {
      throw new Error("provider down");
    }
  });

  const result = await service.sendWorkspaceInviteEmail({
    email: "invitee@example.com",
    workspace: {
      name: "Acme Workspace"
    }
  });

  assert.equal(result.delivered, false);
  assert.equal(result.reason, "provider_error");
});

test("workspace invite email service testables expose sender resolver", () => {
  const fakeCommunicationsService = {
    async sendEmail() {
      return { sent: true };
    }
  };

  const resolvedSendEmail = __testables.resolveSendEmail({
    communicationsService: fakeCommunicationsService
  });
  assert.equal(typeof resolvedSendEmail, "function");
  assert.equal(__testables.normalizeReason(" NOT_CONFIGURED "), "not_configured");
});
