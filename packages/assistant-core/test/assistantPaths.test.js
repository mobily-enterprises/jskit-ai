import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssistantApiPath,
  buildAssistantSettingsApiPath,
  resolveAssistantApiBasePath,
  resolveAssistantSettingsApiPath
} from "../src/shared/assistantPaths.js";

test("assistant path helpers derive workspace and non-workspace API bases from surface workspace requirements", () => {
  assert.equal(resolveAssistantApiBasePath({ requiresWorkspace: false }), "/api/assistant");
  assert.equal(resolveAssistantApiBasePath({ requiresWorkspace: true }), "/api/w/:workspaceSlug/assistant");

  assert.equal(resolveAssistantSettingsApiPath({ requiresWorkspace: false }), "/api/assistant/:surfaceId/settings");
  assert.equal(resolveAssistantSettingsApiPath({ requiresWorkspace: true }), "/api/w/:workspaceSlug/assistant/:surfaceId/settings");
});

test("assistant path builders materialize workspace-aware and public API paths", () => {
  assert.equal(
    buildAssistantApiPath({
      requiresWorkspace: false,
      suffix: "/conversations"
    }),
    "/api/assistant/conversations"
  );

  assert.equal(
    buildAssistantApiPath({
      requiresWorkspace: true,
      workspaceSlug: "acme",
      suffix: "/conversations"
    }),
    "/api/w/acme/assistant/conversations"
  );

  assert.equal(
    buildAssistantSettingsApiPath({
      requiresWorkspace: false,
      surfaceId: "admin"
    }),
    "/api/assistant/admin/settings"
  );

  assert.equal(
    buildAssistantSettingsApiPath({
      requiresWorkspace: true,
      workspaceSlug: "acme",
      surfaceId: "admin"
    }),
    "/api/w/acme/assistant/admin/settings"
  );
});
