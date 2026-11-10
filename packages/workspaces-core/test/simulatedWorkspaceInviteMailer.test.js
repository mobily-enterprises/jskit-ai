import assert from "node:assert/strict";
import test from "node:test";
import { createSimulatedWorkspaceInviteMailer } from "../src/server/workspaceMembers/simulatedWorkspaceInviteMailer.js";

test("a test copy's invite mailer sends nothing, logs the invitation and reports it simulated", async () => {
  const logs = [];
  const mailer = createSimulatedWorkspaceInviteMailer({
    info: (details, message) => logs.push({ details, message }),
    warn() {},
    error() {},
    debug() {}
  });
  const delivery = await mailer.sendWorkspaceInvite({
    email: "guest@example.com",
    inviteUrl: "https://app.example.test/invite?token=abc",
    message: { subject: "You're invited to Books", text: "Join us", html: "<p>Join us</p>" }
  });
  assert.equal(delivery.status, "simulated");
  assert.equal(delivery.messageCode, "workspaces.invite.simulated");
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].details, {
    sideEffects: "simulate",
    kind: "email",
    email: "guest@example.com",
    subject: "You're invited to Books",
    inviteUrl: "https://app.example.test/invite?token=abc"
  });
  assert.match(logs[0].message, /^Test copy: the workspace invitation email to guest@example\.com was simulated, not sent/u);
});
