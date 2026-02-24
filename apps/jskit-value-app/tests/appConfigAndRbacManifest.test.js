import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { resolveAppConfig, toBrowserConfig } from "@jskit-ai/runtime-env-core/appRuntimePolicy";
import {
  OWNER_ROLE_ID,
  createOwnerOnlyManifest,
  hasPermission,
  listManifestPermissions,
  loadRbacManifest,
  manifestIncludesPermission,
  normalizeManifest,
  resolveRolePermissions
} from "@jskit-ai/rbac-core";

test("resolveAppConfig normalizes tenancy, limits, feature gates, and manifest path", () => {
  const personal = resolveAppConfig({
    repositoryConfig: {
      app: {
        tenancyMode: "unknown",
        features: {
          workspaceSwitching: true,
          workspaceInvites: true,
          workspaceCreateEnabled: true
        },
        limits: {
          maxWorkspacesPerUser: 0
        }
      },
      ai: {
        enabled: false,
        requiredPermission: ""
      }
    },
    runtimeEnv: {},
    rootDir: "/repo-root"
  });

  assert.equal(personal.tenancyMode, "personal");
  assert.equal(personal.features.workspaceSwitching, true);
  assert.equal(personal.features.workspaceInvites, false);
  assert.equal(personal.features.workspaceCreateEnabled, false);
  assert.equal(personal.features.assistantEnabled, false);
  assert.equal(personal.features.assistantRequiredPermission, "");
  assert.equal(personal.limits.maxWorkspacesPerUser, 1);
  assert.equal(personal.rbacManifestPath, path.resolve("/repo-root", "shared", "auth", "rbac.manifest.json"));

  const multiWorkspace = resolveAppConfig({
    repositoryConfig: {
      app: {
        tenancyMode: "multi-workspace",
        features: {
          workspaceSwitching: false,
          workspaceInvites: false,
          workspaceCreateEnabled: false
        },
        limits: {
          maxWorkspacesPerUser: 33
        }
      },
      ai: {
        enabled: true,
        requiredPermission: " workspace.ai.use "
      }
    },
    runtimeEnv: {
      RBAC_MANIFEST_PATH: "config/rbac.json"
    },
    rootDir: "/repo-root"
  });

  assert.equal(multiWorkspace.tenancyMode, "multi-workspace");
  assert.equal(multiWorkspace.features.workspaceSwitching, true);
  assert.equal(multiWorkspace.features.workspaceInvites, false);
  assert.equal(multiWorkspace.features.workspaceCreateEnabled, false);
  assert.equal(multiWorkspace.features.assistantEnabled, true);
  assert.equal(multiWorkspace.features.assistantRequiredPermission, "workspace.ai.use");
  assert.equal(multiWorkspace.limits.maxWorkspacesPerUser, 33);
  assert.equal(multiWorkspace.rbacManifestPath, path.resolve("/repo-root", "config/rbac.json"));

  const absoluteManifest = resolveAppConfig({
    repositoryConfig: {
      app: {
        tenancyMode: "team-single",
        features: {
          workspaceSwitching: false,
          workspaceInvites: true,
          workspaceCreateEnabled: true
        },
        limits: {
          maxWorkspacesPerUser: 1
        }
      },
      ai: {
        enabled: false,
        requiredPermission: ""
      }
    },
    runtimeEnv: {
      RBAC_MANIFEST_PATH: "/etc/app/rbac.json"
    },
    rootDir: "/repo-root"
  });

  assert.equal(absoluteManifest.rbacManifestPath, "/etc/app/rbac.json");
});

test("toBrowserConfig returns only browser-safe feature state", () => {
  const browserConfig = toBrowserConfig({
    tenancyMode: "multi-workspace",
    features: {
      workspaceSwitching: 1,
      workspaceInvites: "",
      workspaceCreateEnabled: true,
      assistantEnabled: 1,
      assistantRequiredPermission: " workspace.ai.use "
    }
  });

  assert.deepEqual(browserConfig, {
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
