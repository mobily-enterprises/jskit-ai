import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveAppConfig, toBrowserConfig } from "../src/server/appRuntimePolicy.js";

test("resolveAppConfig normalizes tenancy, limits, feature gates, and manifest path", () => {
  const personal = resolveAppConfig({
    repositoryConfig: {
      app: {
        tenancyMode: "unknown",
        workspaceProvisioningMode: "invalid-mode",
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
      },
      social: {
        enabled: true,
        federationEnabled: false
      }
    },
    runtimeEnv: {},
    rootDir: "/repo-root"
  });

  assert.equal(personal.tenancyMode, "personal");
  assert.equal(personal.workspaceProvisioningMode, "self-serve");
  assert.equal(personal.features.workspaceSwitching, true);
  assert.equal(personal.features.workspaceInvites, false);
  assert.equal(personal.features.workspaceCreateEnabled, false);
  assert.equal(personal.features.assistantEnabled, false);
  assert.equal(personal.features.assistantRequiredPermission, "");
  assert.equal(personal.features.socialEnabled, true);
  assert.equal(personal.features.socialFederationEnabled, false);
  assert.equal(personal.limits.maxWorkspacesPerUser, 1);
  assert.equal(personal.rbacManifestPath, path.resolve("/repo-root", "shared", "auth", "rbac.manifest.json"));

  const multiWorkspace = resolveAppConfig({
    repositoryConfig: {
      app: {
        tenancyMode: "multi-workspace",
        workspaceProvisioningMode: "governed",
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
      },
      social: {
        enabled: true,
        federationEnabled: true
      }
    },
    runtimeEnv: {
      RBAC_MANIFEST_PATH: "config/rbac.json"
    },
    rootDir: "/repo-root"
  });

  assert.equal(multiWorkspace.tenancyMode, "multi-workspace");
  assert.equal(multiWorkspace.workspaceProvisioningMode, "governed");
  assert.equal(multiWorkspace.features.workspaceSwitching, true);
  assert.equal(multiWorkspace.features.workspaceInvites, false);
  assert.equal(multiWorkspace.features.workspaceCreateEnabled, false);
  assert.equal(multiWorkspace.features.assistantEnabled, true);
  assert.equal(multiWorkspace.features.assistantRequiredPermission, "workspace.ai.use");
  assert.equal(multiWorkspace.features.socialEnabled, true);
  assert.equal(multiWorkspace.features.socialFederationEnabled, true);
  assert.equal(multiWorkspace.limits.maxWorkspacesPerUser, 33);
  assert.equal(multiWorkspace.rbacManifestPath, path.resolve("/repo-root", "config/rbac.json"));

  const absoluteManifest = resolveAppConfig({
    repositoryConfig: {
      app: {
        tenancyMode: "team-single",
        workspaceProvisioningMode: "self-serve",
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
      },
      social: {
        enabled: false,
        federationEnabled: true
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
      assistantRequiredPermission: " workspace.ai.use ",
      socialEnabled: 1,
      socialFederationEnabled: 0
    }
  });

  assert.deepEqual(browserConfig, {
    tenancyMode: "multi-workspace",
    features: {
      workspaceSwitching: true,
      workspaceInvites: false,
      workspaceCreateEnabled: true,
      assistantEnabled: true,
      assistantRequiredPermission: "workspace.ai.use",
      socialEnabled: true,
      socialFederationEnabled: false
    }
  });
});
