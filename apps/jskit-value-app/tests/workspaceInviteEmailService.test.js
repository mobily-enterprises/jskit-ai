import assert from "node:assert/strict";
import test from "node:test";

import {
  createService as createWorkspaceInviteEmailService,
  __testables
} from "../server/domain/workspace/services/inviteEmail.service.js";

test("workspace invite email service validates configured driver", () => {
  assert.throws(() => createWorkspaceInviteEmailService({ driver: "postal" }), /Unsupported WORKSPACE_INVITE_EMAIL_DRIVER/);
  assert.equal(__testables.normalizeDriver("none"), "none");
  assert.equal(__testables.normalizeDriver("smtp"), "smtp");
});

test("workspace invite email service skips delivery when not configured", async () => {
  const service = createWorkspaceInviteEmailService({
    driver: "none"
  });

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
    roleId: "member"
  });

  assert.deepEqual(result, {
    delivered: false,
    reason: "not_configured"
  });
});

test("workspace invite email service returns not-implemented payload for smtp scaffold", async () => {
  const service = createWorkspaceInviteEmailService({
    driver: "smtp",
    appPublicUrl: "http://localhost:5173",
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpSecure: false,
    smtpUsername: "mailer",
    smtpPassword: "secret",
    smtpFrom: "mailer@example.com"
  });

  const result = await service.sendWorkspaceInviteEmail({
    email: "invitee@example.com",
    workspace: {
      name: "Acme Workspace"
    },
    invitedBy: {
      displayName: "Owner"
    },
    roleId: "admin"
  });

  assert.equal(result.delivered, false);
  assert.equal(result.reason, "not_implemented");
  assert.equal(result.driver, "smtp");
  assert.equal(result.message.subject.includes("Acme Workspace"), true);
  assert.equal(result.message.text.includes("Role: admin"), true);
  assert.equal(result.message.text.includes("Invited by: Owner"), true);
  assert.equal(result.message.text.includes("http://localhost:5173/workspaces"), true);
});
