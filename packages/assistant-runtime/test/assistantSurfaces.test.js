import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAssistantConfigScope,
  resolveAssistantSurfaceConfig
} from "../src/shared/assistantSurfaces.js";

test("assistant surface config resolves runtime/settings surface requirements from app config", () => {
  const appConfig = {
    surfaceDefinitions: {
      admin: { id: "admin", enabled: true, requiresWorkspace: true, accessPolicyId: "workspace_member" },
      console: { id: "console", enabled: true, requiresWorkspace: false, accessPolicyId: "console_owner" }
    },
    assistantSurfaces: {
      admin: {
        settingsSurfaceId: "console",
        configScope: "global"
      }
    }
  };

  const assistantSurface = resolveAssistantSurfaceConfig(appConfig, "admin");
  assert.deepEqual(assistantSurface, {
    targetSurfaceId: "admin",
    settingsSurfaceId: "console",
    configScope: "global",
    runtimeSurfaceRequiresWorkspace: true,
    settingsSurfaceRequiresWorkspace: false,
    settingsSurfaceRequiresConsoleOwner: true
  });
});

test("assistant surface config rejects invalid workspace-scoped assistant combinations", () => {
  const appConfig = {
    surfaceDefinitions: {
      home: { id: "home", enabled: true, requiresWorkspace: false, accessPolicyId: "public" },
      console: { id: "console", enabled: true, requiresWorkspace: false, accessPolicyId: "console_owner" }
    },
    assistantSurfaces: {
      home: {
        settingsSurfaceId: "console",
        configScope: "workspace"
      }
    }
  };

  assert.equal(resolveAssistantSurfaceConfig(appConfig, "home"), null);
  assert.equal(normalizeAssistantConfigScope("workspace"), "workspace");
  assert.equal(normalizeAssistantConfigScope("weird"), "global");
});
