import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkspaceInvitationsPolicy } from "../src/server/support/workspaceInvitationsPolicy.js";

test("workspace invitations policy enables invitations by default in personal mode", () => {
  const policy = resolveWorkspaceInvitationsPolicy({
    appConfig: {},
    tenancyProfile: {
      mode: "personal",
      workspace: {
        enabled: true
      }
    }
  });

  assert.equal(policy.enabled, true);
  assert.equal(policy.allowInPersonalMode, true);
});

test("workspace invitations policy disables invitations in personal mode when explicitly configured", () => {
  const policy = resolveWorkspaceInvitationsPolicy({
    appConfig: {
      workspaceInvitations: {
        allowInPersonalMode: false
      }
    },
    tenancyProfile: {
      mode: "personal",
      workspace: {
        enabled: true
      }
    }
  });

  assert.equal(policy.enabled, false);
  assert.equal(policy.allowInPersonalMode, false);
});

test("workspace invitations policy disables invitations when workspace mode is disabled", () => {
  const policy = resolveWorkspaceInvitationsPolicy({
    appConfig: {},
    tenancyProfile: {
      mode: "none",
      workspace: {
        enabled: false
      }
    }
  });

  assert.equal(policy.enabled, false);
  assert.equal(policy.workspaceEnabled, false);
});

test("workspace invitations policy disables invitations when app config disables feature", () => {
  const policy = resolveWorkspaceInvitationsPolicy({
    appConfig: {
      workspaceInvitations: {
        enabled: false,
        allowInPersonalMode: true
      }
    },
    tenancyProfile: {
      mode: "workspace",
      workspace: {
        enabled: true
      }
    }
  });

  assert.equal(policy.enabled, false);
});

test("workspace invitations policy lets any account accept only when the app opts in and invitations are on", () => {
  const workspaces = { mode: "workspaces", workspace: { enabled: true } };
  assert.equal(resolveWorkspaceInvitationsPolicy({ appConfig: {}, tenancyProfile: workspaces }).anyAccount, false);
  assert.equal(resolveWorkspaceInvitationsPolicy({ appConfig: { workspaceInvitations: { anyAccount: "yes" } }, tenancyProfile: workspaces }).anyAccount, false);
  assert.equal(resolveWorkspaceInvitationsPolicy({ appConfig: { workspaceInvitations: { anyAccount: true } }, tenancyProfile: workspaces }).anyAccount, true);
  assert.equal(resolveWorkspaceInvitationsPolicy({
    appConfig: { workspaceInvitations: { anyAccount: true, enabled: false } },
    tenancyProfile: workspaces
  }).anyAccount, false);
});
