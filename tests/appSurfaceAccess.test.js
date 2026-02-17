import assert from "node:assert/strict";
import test from "node:test";
import { canAccessWorkspace, extractAppSurfacePolicy } from "../surfaces/appSurface.js";

test("app surface denies unauthenticated access", () => {
  const result = canAccessWorkspace();
  assert.deepEqual(result, {
    allowed: false,
    reason: "authentication_required",
    permissions: []
  });
});

test("app surface requires active membership", () => {
  const result = canAccessWorkspace({
    user: { id: 7, email: "member@example.com" },
    resolvePermissions: () => ["history.read", "history.write"]
  });

  assert.deepEqual(result, {
    allowed: false,
    reason: "membership_required",
    permissions: []
  });
});

test("app surface grants role-derived permissions for active membership", () => {
  const result = canAccessWorkspace({
    user: { id: 7, email: "viewer@example.com" },
    membership: { roleId: "viewer", status: "active" },
    resolvePermissions: () => ["history.read"]
  });

  assert.deepEqual(result, {
    allowed: true,
    reason: "allowed",
    permissions: ["history.read"]
  });
});

test("app surface deny-list checks still veto active members", () => {
  const deniedByEmail = canAccessWorkspace({
    user: { id: 7, email: "blocked@example.com" },
    membership: { roleId: "member", status: "active" },
    resolvePermissions: () => ["history.read", "history.write"],
    workspaceSettings: {
      features: {
        surfaceAccess: {
          app: {
            denyEmails: ["blocked@example.com"]
          }
        }
      }
    }
  });

  assert.deepEqual(deniedByEmail, {
    allowed: false,
    reason: "email_denied",
    permissions: []
  });

  const deniedByUserId = canAccessWorkspace({
    user: { id: 9, email: "ok@example.com" },
    membership: { roleId: "member", status: "active" },
    resolvePermissions: () => ["history.read", "history.write"],
    workspaceSettings: {
      features: {
        surfaceAccess: {
          app: {
            denyUserIds: [9]
          }
        }
      }
    }
  });

  assert.deepEqual(deniedByUserId, {
    allowed: false,
    reason: "user_denied",
    permissions: []
  });
});

test("app surface policy extractor normalizes deny-list values", () => {
  const policy = extractAppSurfacePolicy({
    features: {
      surfaceAccess: {
        app: {
          denyUserIds: [1, "2", 0, -1, "abc", 1],
          denyEmails: [" A@Example.com ", "", null, "a@example.com", "b@example.com"]
        }
      }
    }
  });

  assert.deepEqual(policy, {
    denyUserIds: [1, 2],
    denyEmails: ["a@example.com", "b@example.com"]
  });
});
