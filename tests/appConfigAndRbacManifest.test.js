import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { resolveAppConfig, toPublicAppConfig } from "../server/lib/appConfig.js";
import {
  OWNER_ROLE_ID,
  createOwnerOnlyManifest,
  hasPermission,
  listManifestPermissions,
  loadRbacManifest,
  manifestIncludesPermission,
  normalizeManifest,
  resolveRolePermissions
} from "../server/lib/rbacManifest.js";

test("resolveAppConfig normalizes tenancy, booleans, limits, and manifest path", () => {
  const personal = resolveAppConfig(
    {
      TENANCY_MODE: "unknown",
      WORKSPACE_SWITCHING_DEFAULT: "1",
      WORKSPACE_INVITES_DEFAULT: "1",
      WORKSPACE_CREATE_ENABLED: "1",
      MAX_WORKSPACES_PER_USER: "0"
    },
    {
      rootDir: "/repo-root"
    }
  );

  assert.equal(personal.tenancyMode, "personal");
  assert.equal(personal.features.workspaceSwitching, true);
  assert.equal(personal.features.workspaceInvites, false);
  assert.equal(personal.features.workspaceCreateEnabled, false);
  assert.equal(personal.features.assistantEnabled, false);
  assert.equal(personal.features.assistantRequiredPermission, "");
  assert.equal(personal.limits.maxWorkspacesPerUser, 1);
  assert.equal(personal.rbacManifestPath, path.resolve("/repo-root", "shared", "auth", "rbac.manifest.json"));

  const multiWorkspace = resolveAppConfig(
    {
      TENANCY_MODE: "multi-workspace",
      MAX_WORKSPACES_PER_USER: "33",
      WORKSPACE_SWITCHING_DEFAULT: "0",
      WORKSPACE_INVITES_DEFAULT: "0",
      WORKSPACE_CREATE_ENABLED: "0",
      RBAC_MANIFEST_PATH: "config/rbac.json"
    },
    {
      rootDir: "/repo-root"
    }
  );

  assert.equal(multiWorkspace.tenancyMode, "multi-workspace");
  assert.equal(multiWorkspace.features.workspaceSwitching, true);
  assert.equal(multiWorkspace.features.workspaceInvites, false);
  assert.equal(multiWorkspace.features.workspaceCreateEnabled, false);
  assert.equal(multiWorkspace.features.assistantEnabled, false);
  assert.equal(multiWorkspace.features.assistantRequiredPermission, "");
  assert.equal(multiWorkspace.limits.maxWorkspacesPerUser, 33);
  assert.equal(multiWorkspace.rbacManifestPath, path.resolve("/repo-root", "config/rbac.json"));

  const absoluteManifest = resolveAppConfig(
    {
      TENANCY_MODE: "team-single",
      RBAC_MANIFEST_PATH: "/etc/app/rbac.json"
    },
    {
      rootDir: "/repo-root"
    }
  );

  assert.equal(absoluteManifest.rbacManifestPath, "/etc/app/rbac.json");
});

test("toPublicAppConfig returns only public feature state", () => {
  const publicConfig = toPublicAppConfig({
    tenancyMode: "multi-workspace",
    features: {
      workspaceSwitching: 1,
      workspaceInvites: "",
      workspaceCreateEnabled: true,
      assistantEnabled: 1,
      assistantRequiredPermission: " workspace.ai.use "
    }
  });

  assert.deepEqual(publicConfig, {
    tenancyMode: "multi-workspace",
    features: {
      workspaceSwitching: true,
      workspaceInvites: false,
      workspaceCreateEnabled: true,
      assistantEnabled: true,
      assistantRequiredPermission: "workspace.ai.use"
    }
  });
});

test("normalizeManifest validates and normalizes role catalog", () => {
  assert.throws(() => normalizeManifest(null), /must be a JSON object/);

  const ownerOnly = normalizeManifest({});
  assert.equal(ownerOnly.roles[OWNER_ROLE_ID].assignable, false);
  assert.deepEqual(ownerOnly.roles[OWNER_ROLE_ID].permissions, ["*"]);
  assert.equal(ownerOnly.defaultInviteRole, null);
  assert.equal(ownerOnly.collaborationEnabled, false);
  assert.deepEqual(ownerOnly.assignableRoleIds, []);

  const normalized = normalizeManifest({
    version: "2",
    defaultInviteRole: "member",
    roles: {
      owner: {
        assignable: false,
        permissions: ["*", "*", "workspace.settings.update"]
      },
      member: {
        assignable: true,
        permissions: ["history.read", " history.read ", "history.write", ""]
      },
      viewer: {
        assignable: false,
        permissions: ["history.read"]
      }
    }
  });

  assert.equal(normalized.version, 2);
  assert.equal(normalized.defaultInviteRole, "member");
  assert.equal(normalized.collaborationEnabled, true);
  assert.deepEqual(normalized.assignableRoleIds, ["member"]);
  assert.deepEqual(normalized.roles.member.permissions, ["history.read", "history.write"]);

  const defaultInviteNotAssignable = normalizeManifest({
    defaultInviteRole: "viewer",
    roles: {
      owner: {
        assignable: false,
        permissions: ["*"]
      },
      viewer: {
        assignable: false,
        permissions: ["history.read"]
      }
    }
  });
  assert.equal(defaultInviteNotAssignable.defaultInviteRole, null);
  assert.equal(defaultInviteNotAssignable.collaborationEnabled, false);

  assert.throws(
    () =>
      normalizeManifest({
        roles: {
          owner: {
            assignable: true,
            permissions: ["*"]
          }
        }
      }),
    /roles\.owner must be non-assignable/
  );

  assert.throws(
    () =>
      normalizeManifest({
        roles: {
          owner: {
            assignable: false,
            permissions: ["history.read"]
          }
        }
      }),
    /permissions must include "\*"/
  );
});

test("RBAC permission helpers resolve owner/wildcard/specific permissions", () => {
  const manifest = normalizeManifest({
    defaultInviteRole: "member",
    roles: {
      owner: {
        assignable: false,
        permissions: ["*"]
      },
      member: {
        assignable: true,
        permissions: ["history.read", "history.write"]
      }
    }
  });

  assert.deepEqual(resolveRolePermissions(manifest, "owner"), ["*"]);
  assert.deepEqual(resolveRolePermissions(manifest, "member"), ["history.read", "history.write"]);
  assert.deepEqual(resolveRolePermissions(manifest, "unknown"), []);

  assert.equal(hasPermission([], ""), true);
  assert.equal(hasPermission(undefined, "history.read"), false);
  assert.equal(hasPermission(["history.read"], "history.read"), true);
  assert.equal(hasPermission(["history.read"], "history.write"), false);
  assert.equal(hasPermission(["*"], "history.write"), true);

  assert.deepEqual(listManifestPermissions(manifest), ["history.read", "history.write"]);
  assert.equal(manifestIncludesPermission(manifest, "history.write"), true);
  assert.equal(manifestIncludesPermission(manifest, "workspace.ai.use"), false);
  assert.equal(manifestIncludesPermission(manifest, "workspace.ai.use", { includeOwner: true }), true);
});

test("createOwnerOnlyManifest and loadRbacManifest cover file read and parse errors", async () => {
  const ownerOnly = createOwnerOnlyManifest();
  assert.equal(ownerOnly.defaultInviteRole, null);
  assert.equal(ownerOnly.collaborationEnabled, false);
  assert.deepEqual(ownerOnly.assignableRoleIds, []);
  assert.deepEqual(ownerOnly.roles.owner.permissions, ["*"]);

  const tmpDir = path.join("/tmp", `rbac-test-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  const validManifestPath = path.join(tmpDir, "rbac.json");
  await fs.writeFile(
    validManifestPath,
    JSON.stringify({
      version: 1,
      defaultInviteRole: "member",
      roles: {
        owner: {
          assignable: false,
          permissions: ["*"]
        },
        member: {
          assignable: true,
          permissions: ["history.read"]
        }
      }
    }),
    "utf8"
  );

  const loaded = await loadRbacManifest(validManifestPath);
  assert.equal(loaded.defaultInviteRole, "member");
  assert.equal(loaded.collaborationEnabled, true);

  const invalidManifestPath = path.join(tmpDir, "invalid.json");
  await fs.writeFile(invalidManifestPath, "{not-json", "utf8");
  await assert.rejects(() => loadRbacManifest(invalidManifestPath), /not valid JSON/);

  await assert.rejects(() => loadRbacManifest(path.join(tmpDir, "missing.json")), /Unable to read RBAC manifest/);
});
