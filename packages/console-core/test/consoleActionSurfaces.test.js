import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveConsoleSurfaceIdsFromAppConfig
} from "../src/server/support/consoleActionSurfaces.js";

test("resolveConsoleSurfaceIdsFromAppConfig resolves all enabled console-owner surfaces", () => {
  const surfaceIds = resolveConsoleSurfaceIdsFromAppConfig({
    surfaceDefinitions: {
      home: { id: "home", enabled: true, requiresWorkspace: false, accessPolicyId: "public" },
      console: { id: "console", enabled: true, requiresWorkspace: false, accessPolicyId: "console_owner" },
      opsConsole: { id: "opsConsole", enabled: true, requiresWorkspace: false, accessPolicyId: "console_owner" },
      app: { id: "app", enabled: true, requiresWorkspace: true, accessPolicyId: "workspace_member" },
      disabledConsole: {
        id: "disabledConsole",
        enabled: false,
        requiresWorkspace: false,
        accessPolicyId: "console_owner"
      }
    }
  });

  assert.deepEqual(surfaceIds, ["console", "opsconsole"]);
});
